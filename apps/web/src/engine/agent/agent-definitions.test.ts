import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAgentDefinition } from '@ui4a/engine';
import type { AgentDefinition } from '@ui4a/shared';

import {
  activateAgentDefinitionVersion,
  ensureAgentDefinitionTables,
  installSeedAgentDefinition,
  registerAgentDefinitionVersion,
} from '../../db/agent-definitions';
import { ensureDraftTables } from '../../db/drafts';
import { ensureEventsTable } from '../../db/events';
import { getPool } from '../../db/pool';
import {
  agentDefinitionDraftRegistryPort,
  getAgentDefinitionCatalog,
  getAgentDefinitionMetaEntity,
} from './agent-definitions';
import { executeDraftMeta } from '../drafts/drafts';
import { getEngine, resetEngineForTests } from '../service';

const pool = getPool(process.env.DATABASE_URL!);

function definition(
  version = 1,
  intent = 'Write a grounded document from authorized sources.',
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
          literal: 'Use only effective grants.',
          sealed: true,
        },
        {
          id: 'objective',
          role: 'user',
          purpose: 'task-data',
          binding: {
            source: 'task',
            pointer: '/objective',
            encoding: 'json-delimited',
            required: true,
          },
        },
      ],
    },
    contracts: {
      inputSchema: {
        type: 'object',
        properties: { objective: { type: 'string' } },
        required: ['objective'],
      },
      outputSchema: { type: 'object', properties: { document: { type: 'string' } } },
    },
    runtimeRequirements: { class: 'document-agent', features: ['structured-result'] },
    policies: {
      tools: { allowed: ['source-read', 'artifact-write'] },
      context: { allowedSources: ['entity'], maxItems: 8 },
      resources: { allowed: ['document-workspace'] },
      artifacts: { allowedMediaTypes: ['text/markdown'], maxCount: 1, maxBytes: 100_000 },
    },
    evaluationPolicy: {
      verifiers: ['schema', 'citation'],
      evalSuiteRefs: ['eval:writing-v1'],
      minimumScore: 0.8,
    },
  };
}

beforeEach(async () => {
  vi.stubEnv(
    'UI4A_AGENT_REGISTRY',
    JSON.stringify({
      runtimeClasses: { 'document-agent': ['structured-result'] },
      tools: ['source-read', 'artifact-write'],
      resources: ['document-workspace'],
      contextSources: ['entity'],
      verifiers: ['schema', 'citation'],
      evalEvidence: {
        'eval:writing-v1': {
          passed: true,
          score: 0.9,
          artifactHash: `sha256:${'1'.repeat(64)}`,
          payload: { corpus: 'writing-v1', passed: true },
        },
      },
    }),
  );
  await ensureEventsTable(pool);
  await ensureAgentDefinitionTables(pool);
  await ensureDraftTables(pool);
  await pool.query(
    'TRUNCATE draft_projection, draft_payloads, agent_definition_active, agent_definition_versions, agent_definition_payloads, events',
  );
  resetEngineForTests();
  const source = definition();
  const artifact = resolveAgentDefinition(source, new Map());
  await registerAgentDefinitionVersion(pool, {
    eventId: 'event:register-writing',
    commandId: 'register-writing',
    actor: 'agent',
    principal: 'local-user',
    policyScope: 'publishing',
    expectedLatestVersion: 0,
    source,
    artifact,
    evalEvidence: { refs: ['eval:writing-v1'] },
  });
  await activateAgentDefinitionVersion(pool, {
    eventId: 'event:activate-writing',
    commandId: 'activate-writing',
    actor: 'human',
    principal: 'local-user',
    policyScope: 'publishing',
    ref: 'writing-agent@1',
    expectedActiveVersion: null,
  });
});

describe('Agent Definition registry adapter and Siren', () => {
  it('projects owner/scope-filtered catalog and exact version without Provider data', async () => {
    await expect(getAgentDefinitionCatalog(pool, 'local-user', 'publishing')).resolves.toEqual([
      expect.objectContaining({
        ref: 'writing-agent@1',
        intent: expect.stringContaining('grounded'),
        runtimeClass: 'document-agent',
      }),
    ]);
    expect(
      await getAgentDefinitionMetaEntity(
        pool,
        'meta/agent-definition:writing-agent@1',
        'local-user',
        'publishing',
      ),
    ).toMatchObject({
      class: ['meta', 'agent-definition', 'active'],
      properties: { ref: 'writing-agent@1', runtimeClass: 'document-agent' },
    });
    expect(
      await getAgentDefinitionMetaEntity(
        pool,
        'meta/agent-definition:writing-agent@1',
        'other-user',
        'publishing',
      ),
    ).toBeUndefined();
  });

  it('merges system seeds for any principal, keeps scope isolation, and lets personal active win', async () => {
    const systemSource = definition(1, 'Repository-owned writing seed.');
    await installSeedAgentDefinition(pool, {
      principal: 'local-user',
      policyScope: 'editorial',
      source: systemSource,
      artifact: resolveAgentDefinition(systemSource, new Map()),
      evalEvidence: { passed: true, score: 1 },
    });

    await expect(getAgentDefinitionCatalog(pool, 'oidc-human', 'editorial')).resolves.toEqual([
      expect.objectContaining({ ref: 'writing-agent@1', intent: 'Repository-owned writing seed.' }),
    ]);
    await expect(getAgentDefinitionCatalog(pool, 'oidc-human', 'development')).resolves.toEqual([]);
    await expect(
      getAgentDefinitionMetaEntity(
        pool,
        'meta/agent-definition:writing-agent@1',
        'oidc-human',
        'editorial',
      ),
    ).resolves.toMatchObject({ properties: { ref: 'writing-agent@1', status: 'active' } });

    const personalSource = definition(1, 'Personal writing definition wins.');
    const personalArtifact = resolveAgentDefinition(personalSource, new Map());
    await registerAgentDefinitionVersion(pool, {
      eventId: 'event:register-personal-writing',
      commandId: 'register-personal-writing',
      actor: 'agent',
      principal: 'oidc-human',
      policyScope: 'editorial',
      expectedLatestVersion: 0,
      source: personalSource,
      artifact: personalArtifact,
      evalEvidence: { refs: ['eval:writing-v1'] },
    });
    await activateAgentDefinitionVersion(pool, {
      eventId: 'event:activate-personal-writing',
      commandId: 'activate-personal-writing',
      actor: 'human',
      principal: 'oidc-human',
      policyScope: 'editorial',
      ref: 'writing-agent@1',
      expectedActiveVersion: null,
    });

    await expect(getAgentDefinitionCatalog(pool, 'oidc-human', 'editorial')).resolves.toEqual([
      expect.objectContaining({
        ref: 'writing-agent@1',
        intent: 'Personal writing definition wins.',
      }),
    ]);
  });

  it('provides Draft validation registries and eval payloads from deployment config', async () => {
    const snapshot = await agentDefinitionDraftRegistryPort.readSnapshot({
      db: pool,
      owner: 'local-user',
      policyScope: 'publishing',
    });
    expect(snapshot.activeByName.get('writing-agent')).toBe('writing-agent@1');
    expect(snapshot.activationRegistries.runtimeClasses.get('document-agent')).toEqual(
      new Set(['structured-result']),
    );
    expect(snapshot.evalEvidencePayloads.get('eval:writing-v1')).toEqual({
      corpus: 'writing-v1',
      passed: true,
    });
  });

  it('atomically activates a human-approved Agent Definition Draft and rejects Agent approval', async () => {
    const engine = await getEngine(pool);
    const candidate = definition(
      2,
      'Write and render a grounded document from authorized sources.',
    );
    const created = await executeDraftMeta(
      pool,
      engine,
      {
        rel: 'meta/drafts',
        action: 'create',
        actor: 'agent',
        principal: 'local-user',
        params: {
          kind: 'agent-definition',
          target: 'writing-agent',
          policyScope: 'publishing',
          commandId: 'draft-writing-v2',
          payload: candidate,
        },
      },
      { policyScope: 'publishing', agentDefinitions: agentDefinitionDraftRegistryPort },
    );
    if (created.kind !== 'accepted') throw new Error(created.reason);
    const draftId = String(created.entity.properties.id);
    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel: `draft:${draftId}`,
        action: 'submit',
        actor: 'agent',
        principal: 'local-user',
        params: { commandId: 'submit-writing-v2' },
      },
      { policyScope: 'publishing', agentDefinitions: agentDefinitionDraftRegistryPort },
    );
    expect(submitted.kind).toBe('accepted');
    const activationRel = `meta/activation:draft-${draftId}`;
    const denied = await executeDraftMeta(
      pool,
      engine,
      {
        rel: activationRel,
        action: 'approve',
        actor: 'agent',
        principal: 'local-user',
        params: { commandId: 'agent-approve-writing-v2' },
      },
      { policyScope: 'publishing', agentDefinitions: agentDefinitionDraftRegistryPort },
    );
    expect(denied).toMatchObject({ kind: 'rejected', reason: 'actor-is-human=false' });

    const approved = await executeDraftMeta(
      pool,
      engine,
      {
        rel: activationRel,
        action: 'approve',
        actor: 'human',
        principal: 'local-user',
        params: { commandId: 'human-approve-writing-v2' },
      },
      { policyScope: 'publishing', agentDefinitions: agentDefinitionDraftRegistryPort },
    );
    expect(approved.kind).toBe('accepted');
    expect((await getAgentDefinitionCatalog(pool, 'local-user', 'publishing'))[0]?.ref).toBe(
      'writing-agent@2',
    );
    const events = await pool.query<{ kind: string }>(
      `SELECT kind FROM events WHERE kind IN
       ('agent-definition-version-registered','agent-definition-version-activated','draft-accepted')
       ORDER BY seq DESC LIMIT 3`,
    );
    expect(events.rows.map((row) => row.kind).reverse()).toEqual([
      'agent-definition-version-registered',
      'agent-definition-version-activated',
      'draft-accepted',
    ]);
  });
});
