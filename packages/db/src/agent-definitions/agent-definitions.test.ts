import { beforeEach, describe, expect, it } from 'vitest';

import { resolveAgentDefinition } from '@ui4a/engine';
import type { AgentDefinition, AgentDefinitionSource, JsonValue } from '@ui4a/shared';

import {
  activateAgentDefinitionVersion,
  agentDefinitionPayloadSha256,
  ensureAgentDefinitionTables,
  getActiveAgentDefinition,
  getAgentDefinitionVersion,
  getSystemSeedAgentDefinitionVersion,
  installSeedAgentDefinition,
  listAgentDefinitionVersions,
  prepareAgentDefinitionActivation,
  readAgentDefinitionPayload,
  readAgentDefinitionRegistry,
  rebuildAgentDefinitionProjection,
  registerAgentDefinitionVersion,
} from './index';
import { appendEvent, ensureEventsTable } from '../events';
import { getPool } from '../pool';

const pool = getPool(process.env.DATABASE_URL!);

function definition(
  version: number,
  intent = 'Write grounded documents from an approved brief.',
): AgentDefinition {
  return {
    schemaVersion: 1,
    ref: `writing-agent@${version}`,
    name: 'writing-agent',
    version,
    intent,
    prompt: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'authority',
          role: 'system',
          purpose: 'authority',
          literal: 'Follow the activated writing contract.',
          sealed: true,
        },
        {
          id: 'brief',
          role: 'user',
          purpose: 'task-data',
          binding: {
            source: 'task',
            pointer: '/brief',
            encoding: 'json-delimited',
            required: true,
          },
        },
      ],
    },
    contracts: {
      inputSchema: {
        type: 'object',
        properties: { brief: { type: 'string' } },
        required: ['brief'],
      },
      outputSchema: { type: 'object', properties: { markdown: { type: 'string' } } },
    },
    runtimeRequirements: { class: 'document-agent', features: ['structured-events'] },
    policies: {
      tools: { allowed: ['documents.read', 'documents.write'] },
      context: { allowedSources: ['entity'], maxItems: 20 },
      resources: { allowed: ['document-workspace'] },
      artifacts: { allowedMediaTypes: ['text/markdown'], maxCount: 4, maxBytes: 65_536 },
    },
    evaluationPolicy: {
      verifiers: ['citation-check', 'document-render'],
      evalSuiteRefs: ['eval-suite:writing-v1'],
      minimumScore: 0.8,
    },
  };
}

function registration(version: number, expectedLatestVersion: number) {
  const source: AgentDefinitionSource = definition(version);
  return {
    eventId: `event:register:writing-agent:${version}`,
    commandId: `command:register:writing-agent:${version}`,
    actor: 'agent',
    principal: 'user:mike',
    policyScope: 'publishing',
    expectedLatestVersion,
    source,
    artifact: resolveAgentDefinition(source, new Map()),
    evalEvidence: {
      suiteRef: 'eval-suite:writing-v1',
      passed: true,
      score: 1,
      receiptRefs: [`eval-receipt:writing-agent:${version}`],
    } as JsonValue,
  };
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureAgentDefinitionTables(pool);
  await pool.query(
    'TRUNCATE agent_definition_active, agent_definition_versions, agent_definition_payloads, events',
  );
});

describe('Agent Definition persistence', () => {
  it('installs a built-in definition idempotently with explicit non-human seed provenance', async () => {
    const source = definition(1);
    const input = {
      principal: 'local-user',
      policyScope: 'development',
      source,
      artifact: resolveAgentDefinition(source, new Map()),
      evalEvidence: { passed: true, score: 1 } as JsonValue,
    };

    const first = await installSeedAgentDefinition(pool, input);
    const retry = await installSeedAgentDefinition(pool, input);

    expect(first.ref).toBe('writing-agent@1');
    expect(retry).toEqual(first);
    expect(
      (await getActiveAgentDefinition(pool, 'writing-agent', 'local-user', 'development'))?.version,
    ).toMatchObject({ status: 'active', registeredActor: 'system:bootstrap' });
    const stored = await pool.query<{ actor: string; detail: Record<string, unknown> }>(
      `SELECT actor,detail FROM events WHERE domain='agent-definition' ORDER BY seq`,
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.every((row) => row.actor === 'agent')).toBe(true);
    expect(stored.rows[1]?.detail).toMatchObject({
      actor: 'system:bootstrap',
      provenance: { kind: 'system-seed' },
    });
  });

  it('resolves one active system seed by exact ref/scope for any authenticated principal', async () => {
    const source = definition(1);
    await installSeedAgentDefinition(pool, {
      principal: 'local-user',
      policyScope: 'development',
      source,
      artifact: resolveAgentDefinition(source, new Map()),
      evalEvidence: { passed: true, score: 1 } as JsonValue,
    });

    await expect(
      getSystemSeedAgentDefinitionVersion(pool, 'writing-agent@1', 'development'),
    ).resolves.toMatchObject({
      version: {
        ref: 'writing-agent@1',
        status: 'active',
        registeredActor: 'system:bootstrap',
        policyScope: 'development',
      },
    });
    await expect(
      getSystemSeedAgentDefinitionVersion(pool, 'writing-agent@1', 'publishing'),
    ).resolves.toBeUndefined();
  });

  it('fails closed when multiple active system seeds for one ref/scope disagree on content', async () => {
    for (const [principal, intent] of [
      ['seed-owner-a', 'Repository seed A'],
      ['seed-owner-b', 'Conflicting repository seed B'],
    ] as const) {
      const source = definition(1, intent);
      await installSeedAgentDefinition(pool, {
        principal,
        policyScope: 'development',
        source,
        artifact: resolveAgentDefinition(source, new Map()),
        evalEvidence: { passed: true, score: 1 } as JsonValue,
      });
    }

    await expect(
      getSystemSeedAgentDefinitionVersion(pool, 'writing-agent@1', 'development'),
    ).rejects.toThrow(/system seed.*conflict/i);
  });

  it('stores source, flattened, Prompt, and Eval content by hash and isolates exact versions', async () => {
    const registered = await registerAgentDefinitionVersion(pool, registration(1, 0));

    expect(registered.version).toMatchObject({
      ref: 'writing-agent@1',
      name: 'writing-agent',
      version: 1,
      status: 'registered',
      principal: 'user:mike',
      policyScope: 'publishing',
    });
    expect(Object.values(registered.version.content)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^sha256:[0-9a-f]{64}$/)]),
    );
    expect(registered.version.content.flattened).toBe(registered.version.flattenedHash);

    const source = await readAgentDefinitionPayload(pool, registered.version.content.source);
    const flattened = await readAgentDefinitionPayload(pool, registered.version.content.flattened);
    const template = await readAgentDefinitionPayload(pool, registered.version.content.template);
    const evaluation = await readAgentDefinitionPayload(
      pool,
      registered.version.content.evaluation,
    );
    expect(source).toEqual(definition(1));
    expect(flattened).toMatchObject({ ref: 'writing-agent@1', definition: definition(1) });
    expect(template).toEqual(definition(1).prompt);
    expect(evaluation).toMatchObject({ passed: true, score: 1 });
    expect(agentDefinitionPayloadSha256(template)).toBe(registered.version.content.template);

    const storedEvent = await pool.query<{ detail: unknown }>(
      `SELECT detail FROM events
       WHERE domain='agent-definition' AND kind='agent-definition-version-registered'`,
    );
    const eventJson = JSON.stringify(storedEvent.rows[0]?.detail);
    expect(eventJson).toContain(registered.version.content.source);
    expect(eventJson).not.toContain('Follow the activated writing contract');

    await expect(
      getAgentDefinitionVersion(pool, 'writing-agent@1', 'user:other', 'publishing'),
    ).resolves.toBeUndefined();
    await expect(
      getAgentDefinitionVersion(pool, 'writing-agent@1', 'user:mike', 'development'),
    ).resolves.toBeUndefined();
    await expect(
      listAgentDefinitionVersions(pool, {
        name: 'writing-agent',
        principal: 'user:other',
        policyScope: 'publishing',
      }),
    ).resolves.toEqual([]);
  });

  it('is command-idempotent and rejects stale, duplicate, or non-consecutive versions', async () => {
    const command = registration(1, 0);
    const first = await registerAgentDefinitionVersion(pool, command);
    const retry = await registerAgentDefinitionVersion(pool, command);
    expect(retry.version).toEqual(first.version);
    expect(retry.event).toBeUndefined();

    await expect(
      registerAgentDefinitionVersion(pool, {
        ...registration(1, 0),
        eventId: 'event:duplicate-version',
        commandId: 'command:duplicate-version',
      }),
    ).rejects.toThrow('version already exists');
    await expect(registerAgentDefinitionVersion(pool, registration(2, 0))).rejects.toThrow(
      'latest version conflict',
    );
    await expect(registerAgentDefinitionVersion(pool, registration(3, 1))).rejects.toThrow(
      'next consecutive version',
    );
  });

  it('uses human-only active-pointer CAS and admits one parallel winner', async () => {
    await registerAgentDefinitionVersion(pool, registration(1, 0));
    await registerAgentDefinitionVersion(pool, registration(2, 1));
    await registerAgentDefinitionVersion(pool, registration(3, 2));

    await expect(
      activateAgentDefinitionVersion(pool, {
        eventId: 'event:activate:agent',
        commandId: 'command:activate:agent',
        actor: 'agent',
        principal: 'user:mike',
        policyScope: 'publishing',
        ref: 'writing-agent@1',
        expectedActiveVersion: null,
      }),
    ).rejects.toThrow('human actor');

    await activateAgentDefinitionVersion(pool, {
      eventId: 'event:activate:1',
      commandId: 'command:activate:1',
      actor: 'human',
      principal: 'user:mike',
      policyScope: 'publishing',
      ref: 'writing-agent@1',
      expectedActiveVersion: null,
    });

    const outcomes = await Promise.allSettled([
      activateAgentDefinitionVersion(pool, {
        eventId: 'event:activate:2',
        commandId: 'command:activate:2',
        actor: 'human',
        principal: 'user:mike',
        policyScope: 'publishing',
        ref: 'writing-agent@2',
        expectedActiveVersion: 1,
      }),
      activateAgentDefinitionVersion(pool, {
        eventId: 'event:activate:3',
        commandId: 'command:activate:3',
        actor: 'human',
        principal: 'user:mike',
        policyScope: 'publishing',
        ref: 'writing-agent@3',
        expectedActiveVersion: 1,
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);

    const active = await getActiveAgentDefinition(pool, 'writing-agent', 'user:mike', 'publishing');
    expect([2, 3]).toContain(active?.version.version);
    await expect(
      getActiveAgentDefinition(pool, 'writing-agent', 'user:mike', 'development'),
    ).resolves.toBeUndefined();

    const activationEvents = await pool.query<{ detail: Record<string, unknown> }>(
      `SELECT detail FROM events
       WHERE domain='agent-definition' AND kind='agent-definition-version-activated'`,
    );
    expect(activationEvents.rows).toHaveLength(2);
    expect(activationEvents.rows[0]?.detail).toMatchObject({
      actor: 'human',
      principal: 'user:mike',
      policyScope: 'publishing',
    });
  });

  it('rebuilds exact versions and the active pointer from an empty projection', async () => {
    await registerAgentDefinitionVersion(pool, registration(1, 0));
    await registerAgentDefinitionVersion(pool, registration(2, 1));
    await activateAgentDefinitionVersion(pool, {
      eventId: 'event:activate:rebuild',
      commandId: 'command:activate:rebuild',
      actor: 'human',
      principal: 'user:mike',
      policyScope: 'publishing',
      ref: 'writing-agent@2',
      expectedActiveVersion: null,
    });

    await pool.query('TRUNCATE agent_definition_active, agent_definition_versions');
    expect(
      await getActiveAgentDefinition(pool, 'writing-agent', 'user:mike', 'publishing'),
    ).toBeUndefined();

    await rebuildAgentDefinitionProjection(pool);

    expect(
      await listAgentDefinitionVersions(pool, {
        name: 'writing-agent',
        principal: 'user:mike',
        policyScope: 'publishing',
      }),
    ).toHaveLength(2);
    await expect(
      getActiveAgentDefinition(pool, 'writing-agent', 'user:mike', 'publishing'),
    ).resolves.toMatchObject({ version: { ref: 'writing-agent@2' } });
  });

  it('prepares a two-event mutation plan for atomic Draft acceptance', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const candidate = registration(1, 0);
      const plan = await prepareAgentDefinitionActivation(client, {
        eventIdPrefix: 'event:draft-accept:writing-agent:1',
        commandId: 'command:draft-accept:writing-agent:1',
        actor: 'human',
        principal: candidate.principal,
        policyScope: candidate.policyScope,
        source: candidate.source,
        artifact: candidate.artifact,
        evalEvidence: candidate.evalEvidence,
        provenance: { draftId: 'draft-writing-1', decidedBy: 'user:mike' },
      });
      expect(plan.events.map((event) => event.kind)).toEqual([
        'agent-definition-version-registered',
        'agent-definition-version-activated',
      ]);
      const seqs: number[] = [];
      for (const event of plan.events) seqs.push((await appendEvent(client, event)).seq);
      await plan.applyProjection({ client, seqs });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await expect(
      getActiveAgentDefinition(pool, 'writing-agent', 'user:mike', 'publishing'),
    ).resolves.toMatchObject({ version: { ref: 'writing-agent@1', status: 'active' } });
    const registry = await readAgentDefinitionRegistry(pool, 'user:mike', 'publishing');
    expect(registry.activeByName.get('writing-agent')).toBe('writing-agent@1');
    expect(registry.definitions.get('writing-agent@1')).toMatchObject({
      status: 'active',
      source: { ref: 'writing-agent@1' },
    });
  });

  it('keeps payload rows append-only and verifies payload integrity on reads', async () => {
    const registered = await registerAgentDefinitionVersion(pool, registration(1, 0));
    await expect(
      pool.query('UPDATE agent_definition_payloads SET payload=$1::jsonb WHERE payload_hash=$2', [
        JSON.stringify({ tampered: true }),
        registered.version.content.source,
      ]),
    ).rejects.toThrow('append-only');

    const stored = await readAgentDefinitionPayload(pool, registered.version.content.source);
    expect(agentDefinitionPayloadSha256(stored)).toBe(registered.version.content.source);
  });
});
