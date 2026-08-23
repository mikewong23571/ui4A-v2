import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentRunBirthReferences, AgentRunCommand, CapabilityRunCommand } from '@ui4a/engine';

import { appendAgentRunCommand, ensureAgentRunTables } from '../db/agent-runs';
import { appendCapabilityRunCommand, ensureCapabilityRunTables } from '../db/capability-runs';
import { ensureEventsTable } from '../db/events';
import { getPool } from '../db/pool';
import { getCapabilityRunEntity } from './capability-runs';
import { executeAgentRunAction, getAgentRunEntity } from './agent-runs';

const pool = getPool(process.env.DATABASE_URL!);

const birth: AgentRunBirthReferences = {
  schemaVersion: 1,
  kind: 'event-native',
  definition: {
    ref: 'writing-agent@1',
    version: 1,
    sourceHash: 'sha256:source',
    parentHashes: [],
    flattenedHash: 'sha256:flattened',
  },
  prompt: { templateHash: 'sha256:template', compiledHash: 'sha256:compiled' },
  runtime: { profileName: 'writing-default', profileVersion: '1', adapterVersion: 'host-v1' },
  taskContract: { ref: 'writing-task@1', hash: 'sha256:task' },
  resultContract: { ref: 'writing-result@1', hash: 'sha256:result' },
};

function createNative(): Extract<AgentRunCommand, { kind: 'create' }> {
  return {
    kind: 'create',
    eventId: 'event:create:native',
    commandId: 'command:create:native',
    runId: 'native-entity',
    principal: 'user:mike',
    policyScope: 'publishing',
    source: { rel: 'writing-request:main', action: 'write', eventId: 'core:30' },
    birth,
    task: {
      schemaVersion: 1,
      contract: birth.taskContract,
      payload: { brief: 'Write the guide.' },
    },
  };
}

const legacyCreate: CapabilityRunCommand = {
  kind: 'create',
  eventId: 'event:create:legacy',
  commandId: 'command:create:legacy',
  runId: 'legacy-entity',
  principal: 'user:mike',
  policyScope: 'publishing',
  source: { rel: 'software-change:main', action: 'start', eventId: 'core:31' },
  profileName: 'coding-default',
  task: {
    schemaVersion: 1,
    repositoryRef: 'repo:fixture',
    baseRevision: 'b'.repeat(40),
    goal: 'implement change',
    constraints: [],
    acceptanceCriteria: ['tests pass'],
    allowedPaths: ['src'],
    budget: {
      timeoutSeconds: 300,
      maxTurns: 20,
      maxRawEvents: 2_000,
      maxRawBytes: 4 * 1024 * 1024,
      maxRawChunkBytes: 64 * 1024,
    },
    redaction: { secretNames: [], redactHostPaths: true },
  },
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureCapabilityRunTables(pool);
  await ensureAgentRunTables(pool);
  await pool.query(
    `TRUNCATE agent_run_projection_state, agent_run_projection, agent_run_payloads,
      capability_run_projection, capability_payloads, events`,
  );
});

describe('Agent Run Siren', () => {
  it('lists mixed runs and exposes native birth/task/source without runtime secrets', async () => {
    await appendCapabilityRunCommand(pool, legacyCreate);
    await appendAgentRunCommand(pool, createNative());

    const collection = await getAgentRunEntity(pool, 'agent-runs', 'user:mike', 'publishing');
    expect(collection).toMatchObject({
      class: ['collection', 'agent-runs'],
      properties: { count: 2 },
    });
    const exact = await getAgentRunEntity(
      pool,
      'agent-run:native-entity',
      'user:mike',
      'publishing',
    );
    expect(exact).toMatchObject({
      class: ['agent-run', 'queued', 'event-native'],
      properties: {
        source: { rel: 'writing-request:main', eventId: 'core:30' },
        birth: {
          definition: { ref: 'writing-agent@1', version: 1 },
          runtime: { profileName: 'writing-default', profileVersion: '1' },
        },
        task: { contract: { ref: 'writing-task@1' }, payload: { brief: 'Write the guide.' } },
        questions: [],
        resourceGrantRequests: [],
      },
      actions: [expect.objectContaining({ name: 'cancel' })],
    });
    expect(JSON.stringify(exact)).not.toMatch(/apiKey|credential|endpoint|model/i);
    await expect(
      getAgentRunEntity(pool, 'agent-run:native-entity', 'user:other', 'publishing'),
    ).resolves.toBeUndefined();
  });

  it('keeps the frozen T18 capability presenter unchanged while adding a canonical legacy view', async () => {
    await appendCapabilityRunCommand(pool, legacyCreate);
    const before = await getCapabilityRunEntity(
      pool,
      'capability-run:legacy-entity',
      'user:mike',
      'publishing',
    );
    const canonical = await getAgentRunEntity(
      pool,
      'agent-run:legacy-entity',
      'user:mike',
      'publishing',
    );
    const after = await getCapabilityRunEntity(
      pool,
      'capability-run:legacy-entity',
      'user:mike',
      'publishing',
    );
    expect(after).toEqual(before);
    expect(canonical).toMatchObject({
      class: ['agent-run', 'queued', 'legacy-t18-reconstructed'],
      properties: { birth: { definition: { ref: 'coding-agent@1' } } },
      actions: [],
      links: [
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ rel: ['legacy-capability-run'] }),
      ],
    });
  });

  it('renders typed question/grant actions and persists human interactions on the same run', async () => {
    let run = (await appendAgentRunCommand(pool, createNative())).aggregate;
    for (const command of [
      {
        kind: 'prepare' as const,
        eventId: 'event:prepare',
        commandId: 'command:prepare',
      },
      { kind: 'start' as const, eventId: 'event:start', commandId: 'command:start' },
    ]) {
      run = (
        await appendAgentRunCommand(pool, {
          ...command,
          runId: run.runId,
          expectedRevision: run.revision,
        })
      ).aggregate;
    }
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'ask-question',
        runId: run.runId,
        expectedRevision: run.revision,
        eventId: 'event:ask',
        commandId: 'command:ask',
        question: { questionId: 'audience', prompt: 'Who is the audience?' },
      })
    ).aggregate;
    let entity = await getAgentRunEntity(
      pool,
      'agent-run:native-entity',
      'user:mike',
      'publishing',
    );
    expect(entity?.actions.map((item) => item.name)).toEqual(['answer-question', 'cancel']);

    const answered = await executeAgentRunAction(
      pool,
      {
        rel: 'agent-run:native-entity',
        action: 'answer-question',
        actor: 'human',
        principal: 'user:mike',
        params: { questionId: 'audience', answer: { value: 'maintainers' } },
      },
      'publishing',
    );
    expect(answered).toMatchObject({
      kind: 'accepted',
      entity: { properties: { status: 'running' } },
    });

    run = (
      await appendAgentRunCommand(pool, {
        kind: 'request-resource-grant',
        runId: run.runId,
        expectedRevision: run.revision + 1,
        eventId: 'event:request-grant',
        commandId: 'command:request-grant',
        request: {
          requestId: 'source-read',
          resource: { kind: 'source', ref: 'entity:guide', operations: ['read'] },
          reason: 'Need approved source.',
        },
      })
    ).aggregate;
    entity = await getAgentRunEntity(pool, 'agent-run:native-entity', 'user:mike', 'publishing');
    expect(entity?.actions.map((item) => item.name)).toEqual([
      'approve-resource-grant',
      'deny-resource-grant',
      'cancel',
    ]);
    const denied = await executeAgentRunAction(
      pool,
      {
        rel: 'agent-run:native-entity',
        action: 'deny-resource-grant',
        actor: 'human',
        principal: 'user:mike',
        params: { requestId: 'source-read', reason: 'Not authorized.' },
      },
      'publishing',
    );
    expect(denied).toMatchObject({
      kind: 'accepted',
      entity: {
        properties: {
          status: 'running',
          resourceGrantRequests: [{ decision: { outcome: 'denied' } }],
        },
      },
    });
  });

  it('rejects agent/system-like interaction and stale or undeclared actions', async () => {
    await appendAgentRunCommand(pool, createNative());
    await expect(
      executeAgentRunAction(
        pool,
        {
          rel: 'agent-run:native-entity',
          action: 'cancel',
          actor: 'agent',
          principal: 'agent:writer',
        },
        'publishing',
      ),
    ).resolves.toMatchObject({ kind: 'rejected', reason: expect.stringContaining('human') });
    await expect(
      executeAgentRunAction(
        pool,
        {
          rel: 'agent-run:native-entity',
          action: 'approve',
          actor: 'human',
          principal: 'user:mike',
        },
        'publishing',
      ),
    ).resolves.toMatchObject({ kind: 'rejected', reason: expect.stringContaining('not declared') });
  });
});
