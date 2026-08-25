import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentRunBirthReferences } from '@ui4a/engine';

import { appendAgentRunCommand, ensureAgentRunTables } from '../../db/agent-runs';
import { ensureEventsTable } from '../../db/events';
import { getPool } from '../../db/pool';
import { resetEngineForTests } from '../../engine/service';

import { GET } from './entity/route';
import { POST } from './exec/route';

const pool = getPool(process.env.DATABASE_URL!);
const birth: AgentRunBirthReferences = {
  schemaVersion: 1,
  kind: 'event-native',
  definition: {
    ref: 'writing-agent@1',
    version: 1,
    sourceHash: 'sha256:source',
    parentHashes: [],
    flattenedHash: 'sha256:flat',
  },
  prompt: { templateHash: 'sha256:template', compiledHash: 'sha256:compiled' },
  runtime: { profileName: 'writing-default', profileVersion: '1', adapterVersion: 'host-v1' },
  taskContract: { ref: 'writing-task@1', hash: 'sha256:task' },
  resultContract: { ref: 'writing-result@1', hash: 'sha256:result' },
};

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureAgentRunTables(pool);
  await pool.query(
    `TRUNCATE agent_run_projection_state, agent_run_projection, agent_run_payloads, events`,
  );
  resetEngineForTests();
});

async function runningRun() {
  let run = (
    await appendAgentRunCommand(pool, {
      kind: 'create',
      eventId: 'event:http:create',
      commandId: 'command:http:create',
      runId: 'http-run',
      principal: 'local-user',
      policyScope: 'development',
      source: { rel: 'writing-request:http', action: 'write', eventId: 'core:http' },
      birth,
      task: {
        schemaVersion: 1,
        contract: birth.taskContract,
        payload: { brief: 'Write the HTTP guide.' },
      },
    })
  ).aggregate;
  run = (
    await appendAgentRunCommand(pool, {
      kind: 'prepare',
      eventId: 'event:http:prepare',
      commandId: 'command:http:prepare',
      runId: run.runId,
      expectedRevision: run.revision,
    })
  ).aggregate;
  return (
    await appendAgentRunCommand(pool, {
      kind: 'start',
      eventId: 'event:http:start',
      commandId: 'command:http:start',
      runId: run.runId,
      expectedRevision: run.revision,
    })
  ).aggregate;
}

describe('Agent Run HTTP contract', () => {
  it('serves exact/list Siren and executes a human question action', async () => {
    const run = await runningRun();
    await appendAgentRunCommand(pool, {
      kind: 'ask-question',
      eventId: 'event:http:question',
      commandId: 'command:http:question',
      runId: run.runId,
      expectedRevision: run.revision,
      question: { questionId: 'tone', prompt: 'Which tone?' },
    });

    const list = await GET(new Request('http://localhost:3100/api/entity?rel=agent-runs'));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ properties: { count: 1 } });

    const exact = await GET(new Request('http://localhost:3100/api/entity?rel=agent-run:http-run'));
    expect(exact.status).toBe(200);
    await expect(exact.json()).resolves.toMatchObject({
      properties: { status: 'needs-input', birth: { definition: { ref: 'writing-agent@1' } } },
      actions: [
        expect.objectContaining({ name: 'answer-question' }),
        expect.objectContaining({ name: 'cancel' }),
      ],
    });

    const answer = await POST(
      new Request('http://localhost:3100/api/exec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rel: 'agent-run:http-run',
          action: 'answer-question',
          params: { questionId: 'tone', answer: 'direct' },
        }),
      }),
    );
    expect(answer.status).toBe(200);
    await expect(answer.json()).resolves.toMatchObject({
      entity: {
        properties: {
          status: 'running',
          questions: [{ questionId: 'tone', answer: { value: 'direct' } }],
        },
      },
    });
  });

  it('returns 404/422 without leaking another owner or scope', async () => {
    await runningRun();
    const hidden = await GET(
      new Request('http://localhost:3100/api/entity?rel=agent-run:http-run', {
        headers: { 'x-ui4a-principal': 'user:other' },
      }),
    );
    expect(hidden.status).toBe(404);

    const rejected = await POST(
      new Request('http://localhost:3100/api/exec', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ui4a-policy-scope': 'other',
        },
        body: JSON.stringify({ rel: 'agent-run:http-run', action: 'cancel' }),
      }),
    );
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({
      error: expect.stringContaining('not authorized'),
    });
  });
});
