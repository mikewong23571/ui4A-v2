import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../temporal/agent-run', () => ({
  dispatchAgentRun: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `agent-${runId}`,
  })),
  cancelAgentRun: vi.fn(async () => undefined),
}));
vi.mock('../temporal/capability', () => ({
  dispatchCodingCapability: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `coding-${runId}`,
  })),
  cancelCodingCapability: vi.fn(async () => undefined),
}));

import { ensureAgentDefinitionTables } from '../db/agent-definitions';
import { appendAgentRunCommand, ensureAgentRunTables, listAgentRuns } from '../db/agent-runs';
import { ensureCapabilityRunTables, listCapabilityRuns } from '../db/capability-runs';
import { ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';
import { dispatchAgentRun } from '../temporal/agent-run';
import { enrichEntityWithAgentRuns } from './agent-runs';
import { finalizeAgentRunSource } from './agent-run-source-callback';
import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL!);
const profile = {
  name: 'default',
  executorClass: 'coding-agent',
  providerId: 'codex',
  transport: 'sdk',
  workspaceBackend: 'isolated-worktree',
  sandbox: 'workspace-write',
  timeoutSeconds: 300,
  maxTurns: 20,
  envAllowlist: ['PATH'],
  networkPolicy: 'none',
};
const writingProfile = {
  name: 'editorial-default',
  runtimeClass: 'document-agent',
  providerId: 'configured-provider',
  transport: 'sdk',
  model: 'writing-model',
  apiKeyEnv: 'WRITING_AGENT_API_KEY',
  artifactBackend: 'isolated-document-workspace',
  timeoutSeconds: 240,
  maxTurns: 16,
  envAllowlist: ['PATH'],
  networkPolicy: 'none',
};

function request() {
  return {
    rel: 'software-change:main',
    action: 'start-implementation',
    actor: 'human' as const,
    principal: 'local-user',
    channel: 'http',
    params: {
      repositoryRef: 'repo-fixture',
      baseRevision: 'a'.repeat(40),
      goal: 'add sum',
      constraints: [],
      acceptanceCriteria: ['tests pass'],
      allowedPaths: ['src', 'test'],
    },
  };
}

function writingRequest() {
  return {
    rel: 'writing-request:main',
    action: 'start-writing',
    actor: 'human' as const,
    principal: 'local-user',
    channel: 'http',
    params: {
      objective: 'Write an evidence-grounded launch note.',
      audience: 'experienced engineers',
      requiredSections: ['Summary', 'Evidence'],
      constraints: ['Be concise'],
      sources: [
        {
          id: 'release',
          title: 'Release facts',
          mediaType: 'text/markdown',
          content: '# Release\nThe feature passed five scenarios.',
          hash: `sha256:${'a'.repeat(64)}`,
        },
      ],
    },
  };
}

beforeEach(async () => {
  vi.stubEnv('UI4A_CODING_EXECUTOR_PROFILES', JSON.stringify([profile]));
  vi.stubEnv('UI4A_DOCUMENT_AGENT_PROFILES', JSON.stringify([writingProfile]));
  vi.mocked(dispatchAgentRun).mockClear();
  await ensureEventsTable(pool);
  await ensureCapabilityRunTables(pool);
  await ensureAgentRunTables(pool);
  await ensureAgentDefinitionTables(pool);
  await pool.query(
    `TRUNCATE agent_run_projection, agent_run_projection_state,
      capability_run_projection, capability_payloads,
      agent_definition_active, agent_definition_versions, agent_definition_payloads, events`,
  );
  resetEngineForTests();
});

describe('native Agent dispatch from an Application capability', () => {
  it('pins definition, typed Prompt, runtime and contracts in one native birth record', async () => {
    const engine = await getEngine(pool);
    const outcome = await engine.exec(request());

    expect(outcome.kind).toBe('accepted');
    const runs = await listAgentRuns(pool, {
      principal: 'local-user',
      policyScope: 'development',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'queued',
      birth: {
        kind: 'event-native',
        definition: { ref: 'coding-agent', version: 1 },
        runtime: { profileName: 'default', profileVersion: '1' },
      },
      task: { payload: { kind: 'coding-task', codingTask: { goal: 'add sum' } } },
    });
    expect(runs[0]?.birth.prompt.compiledHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(runs[0]?.task.payload).toMatchObject({
      compiledPrompt: {
        compiledHash: runs[0]?.birth.prompt.compiledHash,
        messages: expect.any(Array),
      },
    });
    expect(
      await listCapabilityRuns(pool, { principal: 'local-user', policyScope: 'development' }),
    ).toEqual([]);
    expect(dispatchAgentRun).toHaveBeenCalledOnce();
  });

  it('fails before the source transition when the exact Runtime profile is missing', async () => {
    vi.stubEnv('UI4A_CODING_EXECUTOR_PROFILES', '[]');
    const engine = await getEngine(pool);
    const before = await readLog(pool);

    await expect(engine.exec(request())).rejects.toThrow('profile');

    expect((await engine.getEntity('software-change:main'))?.properties.node).toBe(
      'implementation-ready',
    );
    expect(await readLog(pool)).toEqual(before);
    expect(dispatchAgentRun).not.toHaveBeenCalled();
  });

  it('fails before the source transition when the exact Agent Definition is unavailable', async () => {
    const engine = await getEngine(pool);
    await pool.query(
      `DELETE FROM agent_definition_active
       WHERE principal='local-user' AND policy_scope='development' AND definition_name='coding-agent'`,
    );
    await pool.query(
      `UPDATE agent_definition_versions SET status='registered'
       WHERE principal='local-user' AND policy_scope='development' AND definition_name='coding-agent'`,
    );
    const before = await readLog(pool);

    await expect(engine.exec(request())).rejects.toThrow('not active');

    expect((await engine.getEntity('software-change:main'))?.properties.node).toBe(
      'implementation-ready',
    );
    expect(await readLog(pool)).toEqual(before);
    expect(dispatchAgentRun).not.toHaveBeenCalled();
  });

  it('maps the Writing Capability through its exact definition/runtime mapper', async () => {
    const engine = await getEngine(pool);
    const outcome = await engine.exec(writingRequest());

    expect(outcome.kind).toBe('accepted');
    const runs = await listAgentRuns(pool, {
      principal: 'local-user',
      policyScope: 'editorial',
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: 'queued',
      birth: {
        definition: { ref: 'writing-agent', version: 1 },
        runtime: {
          profileName: 'editorial-default',
          adapterVersion: 'document-agent-runtime@1',
        },
      },
      task: {
        payload: {
          kind: 'writing-task',
          writingBrief: {
            schemaVersion: 1,
            objective: 'Write an evidence-grounded launch note.',
            audience: 'experienced engineers',
            format: 'markdown',
            requiredSections: ['Summary', 'Evidence'],
            constraints: ['Be concise'],
            allowedOutputPaths: ['out/document.md'],
            sources: [{ id: 'release' }],
            citationPolicy: {
              style: 'paragraph-markers',
              requireEveryFactualParagraph: true,
            },
            budget: {
              timeoutSeconds: 240,
              maxTurns: 16,
              maxRawEvents: 2000,
              maxRawBytes: 4194304,
              maxRawChunkBytes: 65536,
            },
          },
          compiledPrompt: { messages: expect.any(Array), compiledHash: expect.any(String) },
        },
      },
    });
    const source = await engine.getEntity('writing-request:main');
    expect(source).toBeDefined();
    expect(
      (await enrichEntityWithAgentRuns(pool, source!, 'local-user', 'editorial')).links.some(
        (link) => link.rel.includes('agent-run'),
      ),
    ).toBe(true);
    expect(dispatchAgentRun).toHaveBeenCalledOnce();
  });

  it('fails before the Writing Flow transition when the server-owned profile is missing', async () => {
    vi.stubEnv('UI4A_DOCUMENT_AGENT_PROFILES', '[]');
    const engine = await getEngine(pool);
    const before = await readLog(pool);

    await expect(engine.exec(writingRequest())).rejects.toThrow(/profile/i);

    expect((await engine.getEntity('writing-request:main'))?.properties.node).toBe('brief-draft');
    expect(await readLog(pool)).toEqual(before);
    expect(dispatchAgentRun).not.toHaveBeenCalled();
  });

  it('rejects request-side Provider, model, profile and output-path overrides', async () => {
    const engine = await getEngine(pool);
    const requestWithOverrides = {
      ...writingRequest(),
      params: {
        ...writingRequest().params,
        providerId: 'request-provider',
        model: 'request-model',
        runtimeProfile: 'request-profile',
        allowedOutputPaths: ['/tmp/outside.md'],
      },
    };

    await expect(engine.exec(requestWithOverrides)).resolves.toMatchObject({
      kind: 'rejected',
      layer: 'schema-invalid',
    });
    expect((await engine.getEntity('writing-request:main'))?.properties.node).toBe('brief-draft');
    expect(dispatchAgentRun).not.toHaveBeenCalled();
  });

  it('returns a Writing result for human accept/reject without publishing and deduplicates callback', async () => {
    const engine = await getEngine(pool);
    await engine.exec(writingRequest());
    let run = (
      await listAgentRuns(pool, { principal: 'local-user', policyScope: 'editorial' })
    )[0]!;
    for (const command of [
      { kind: 'prepare' as const, id: 'prepare' },
      { kind: 'start' as const, id: 'start' },
    ]) {
      run = (
        await appendAgentRunCommand(pool, {
          kind: command.kind,
          runId: run.runId,
          expectedRevision: run.revision,
          eventId: `event:writing:${command.id}`,
          commandId: `command:writing:${command.id}`,
        })
      ).aggregate;
    }
    run = (
      await appendAgentRunCommand(pool, {
        kind: 'succeed',
        runId: run.runId,
        expectedRevision: run.revision,
        eventId: 'event:writing:succeed',
        commandId: 'command:writing:succeed',
        result: {
          schemaVersion: 1,
          contract: run.birth.resultContract,
          resultId: 'writing-result-1',
          payload: {
            writingResult: {
              schemaVersion: 1,
              resultId: 'writing-result-1',
              status: 'completed',
              summary: 'Draft ready.',
              artifact: {
                path: 'out/document.md',
                hash: `sha256:${'b'.repeat(64)}`,
                sizeBytes: 128,
                mediaType: 'text/markdown',
              },
              citations: [],
              safety: {
                sourceInputsUnchanged: true,
                onlyAllowedOutputs: true,
                noRepositoryEffects: true,
                noNetworkEffects: true,
                noPublishEffects: true,
              },
            },
          },
          artifacts: [
            {
              ref: 'artifact:writing-result-1',
              hash: `sha256:${'b'.repeat(64)}`,
              mediaType: 'text/markdown',
              sizeBytes: 128,
            },
          ],
          evidence: [
            {
              ref: 'render:writing-result-1',
              kind: 'markdown-render',
              hash: `sha256:${'c'.repeat(64)}`,
            },
          ],
          proposedEffects: [],
        },
      })
    ).aggregate;

    await expect(finalizeAgentRunSource(pool, run.runId)).resolves.toMatchObject({
      ok: true,
      deduplicated: false,
      entity: { properties: { node: 'review-ready' } },
    });
    await expect(finalizeAgentRunSource(pool, run.runId)).resolves.toMatchObject({
      ok: true,
      deduplicated: true,
    });
    await expect(
      engine.exec({
        rel: 'writing-request:main',
        action: 'accept-writing-result',
        actor: 'agent',
        principal: 'agent:writer',
      }),
    ).resolves.toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    const accepted = await engine.exec({
      rel: 'writing-request:main',
      action: 'accept-writing-result',
      actor: 'human',
      principal: 'local-user',
    });
    expect(accepted.kind === 'accepted' && accepted.entity.properties.node).toBe('accepted');
    expect(accepted.kind === 'accepted' && accepted.appended).toEqual([]);
    expect((await engine.getEntity('post:first-post'))?.properties.node).toBe('published');
    await expect(finalizeAgentRunSource(pool, run.runId)).resolves.toMatchObject({
      ok: true,
      deduplicated: true,
    });
  });
});
