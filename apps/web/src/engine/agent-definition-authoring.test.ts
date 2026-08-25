import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../temporal/agent-run', () => ({
  dispatchAgentRun: vi.fn(async ({ runId }: { runId: string }) => ({
    workflowId: `agent-${runId}`,
  })),
  cancelAgentRun: vi.fn(async () => undefined),
}));

import type { AgentDefinition } from '@ui4a/shared';

import {
  ensureAgentDefinitionTables,
  getActiveAgentDefinition,
  rebuildAgentDefinitionProjection,
} from '../db/agent-definitions';
import {
  appendAgentRunCommand,
  ensureAgentRunTables,
  getAgentRun,
  listAgentRuns,
} from '../db/agent-runs';
import { ensureDraftTables, getDraft, listDrafts, rebuildDraftProjection } from '../db/drafts';
import { ensureEventsTable, readLog } from '../db/events';
import { getPool } from '../db/pool';
import { dispatchAgentRun } from '../temporal/agent-run';
import { agentDefinitionDraftRegistryPort } from './agent-definitions';
import { finalizeAgentRunSource } from './agent-run-source-callback';
import { getAgentRunEntity } from './agent-runs';
import { executeDraftMeta, getDraftMetaEntity } from './drafts';
import { getEngine, resetEngineForTests } from './service';

const pool = getPool(process.env.DATABASE_URL!);
const profile = {
  name: 'authoring-default',
  runtimeClass: 'agent-definition-authoring',
  providerId: 'codex',
  transport: 'sdk',
  model: 'authoring-model',
  apiKeyEnv: 'AUTHORING_AGENT_API_KEY',
  timeoutSeconds: 240,
  maxTurns: 16,
  envAllowlist: ['PATH'],
  networkPolicy: 'none',
};

const candidate: AgentDefinition = {
  schemaVersion: 1,
  ref: 'support-triage@1',
  name: 'support-triage',
  version: 1,
  intent: 'Classify support cases and propose replies without sending them.',
  prompt: {
    schemaVersion: 1,
    blocks: [
      {
        id: 'authority',
        role: 'system',
        purpose: 'authority',
        literal: 'Classify only the supplied case. Never send a reply.',
        sealed: true,
      },
      {
        id: 'case',
        role: 'user',
        purpose: 'task-data',
        binding: {
          source: 'task',
          pointer: '/case',
          encoding: 'json-delimited',
          required: true,
        },
      },
    ],
  },
  contracts: {
    inputSchema: {
      type: 'object',
      properties: { case: { type: 'string' } },
      required: ['case'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { classification: { type: 'string' }, proposedReply: { type: 'string' } },
      required: ['classification', 'proposedReply'],
      additionalProperties: false,
    },
  },
  runtimeRequirements: { class: 'general-agent', features: ['structured-events'] },
  policies: {
    tools: { allowed: [] },
    context: { allowedSources: [], maxItems: 0 },
    resources: { allowed: [] },
    artifacts: { allowedMediaTypes: ['application/json'], maxCount: 4, maxBytes: 65_536 },
  },
  evaluationPolicy: {
    verifiers: ['schema'],
    evalSuiteRefs: ['eval:support-triage@1'],
    minimumScore: 1,
  },
};

function authoringRequest() {
  return {
    rel: 'agent-definition-request:main',
    action: 'start-authoring',
    actor: 'human' as const,
    principal: 'local-user',
    channel: 'http',
    params: {
      description: 'Create a support triage Agent that proposes but never sends replies.',
    },
  };
}

beforeEach(async () => {
  vi.stubEnv('UI4A_AGENT_AUTHORING_PROFILES', JSON.stringify([profile]));
  vi.stubEnv(
    'UI4A_AGENT_REGISTRY',
    JSON.stringify({
      runtimeClasses: {
        'general-agent': ['structured-events'],
        'document-agent': [
          'structured-result',
          'streamed-events',
          'cancel',
          'resume',
          'document-workspace',
          'artifact-write',
        ],
        'agent-definition-authoring': ['structured-result', 'streamed-events', 'cancel', 'resume'],
      },
      tools: ['source-read', 'artifact-write', 'artifact-hash', 'word-count'],
      resources: ['document-workspace', 'writing-sources'],
      contextSources: ['agent-definition-registry'],
      verifiers: [
        'schema',
        'agent-definition-schema',
        'agent-definition-safety',
        'agent-definition-eval',
      ],
      evalEvidence: {
        'eval:support-triage@1': {
          passed: true,
          score: 1,
          artifactHash: `sha256:${'e'.repeat(64)}`,
          payload: { variants: 5, passed: 5, safety: 1 },
        },
      },
    }),
  );
  vi.mocked(dispatchAgentRun).mockClear();
  await ensureEventsTable(pool);
  await ensureAgentRunTables(pool);
  await ensureDraftTables(pool);
  await ensureAgentDefinitionTables(pool);
  await pool.query(
    `TRUNCATE draft_projection, draft_payloads,
      agent_run_projection, agent_run_projection_state, agent_run_payloads,
      agent_definition_active, agent_definition_versions, agent_definition_payloads, events`,
  );
  resetEngineForTests();
});

async function completeAuthoringRun(source: unknown = candidate) {
  const engine = await getEngine(pool);
  await engine.exec(authoringRequest());
  let run = (await listAgentRuns(pool, { principal: 'local-user', policyScope: 'governance' }))[0]!;
  for (const [kind, id] of [
    ['prepare', 'prepare'],
    ['start', 'start'],
  ] as const) {
    run = (
      await appendAgentRunCommand(pool, {
        kind,
        runId: run.runId,
        expectedRevision: run.revision,
        eventId: `event:authoring:${id}`,
        commandId: `command:authoring:${id}`,
      })
    ).aggregate;
  }
  run = (
    await appendAgentRunCommand(pool, {
      kind: 'succeed',
      runId: run.runId,
      expectedRevision: run.revision,
      eventId: 'event:authoring:succeed',
      commandId: 'command:authoring:succeed',
      result: {
        schemaVersion: 1,
        contract: run.birth.resultContract,
        resultId: 'authoring-result-1',
        payload: {
          authoringResult: {
            schemaVersion: 1,
            resultId: 'authoring-result-1',
            status: 'completed',
            summary: 'Drafted support triage Agent.',
            candidate: source as never,
            examples: [
              {
                name: 'access issue',
                inputJson: '{"case":"Cannot login"}',
                expectedOutcome: 'Classifies as access and proposes an unsent reply.',
              },
            ],
            evalCorpus: [
              {
                id: 'eval:support-triage@1',
                taskJson: '{"case":"Cannot login"}',
                acceptanceCriteria: ['Classifies the issue', 'Does not send a reply'],
              },
            ],
            safety: {
              draftOnly: true,
              noApprovalRequested: true,
              noActivationRequested: true,
              noRuntimeOverride: true,
            },
            validation: {
              valid: true,
              issues: [],
              pendingEvalSuiteRefs: ['eval:support-triage@1'],
              checks: [{ name: 'provider-inspection', pass: true }],
            },
          },
        } as unknown as never,
        artifacts: [
          {
            ref: 'artifact:authoring-result-1',
            hash: `sha256:${'d'.repeat(64)}`,
            mediaType: 'application/json',
            sizeBytes: 1_024,
          },
        ],
        evidence: [
          {
            ref: 'authoring-parse:1',
            kind: 'agent-definition-source-parse',
            hash: `sha256:${'e'.repeat(64)}`,
            detail: { passed: true },
          },
          {
            ref: 'authoring-invariants:1',
            kind: 'agent-definition-non-eval-invariants',
            detail: { passed: true },
          },
          {
            ref: 'authoring-eval:1',
            kind: 'agent-definition-eval-corpus-proposed',
            detail: { passed: true, executed: false },
          },
          {
            ref: 'authoring-draft-only:1',
            kind: 'agent-definition-draft-only',
            detail: { passed: true, approval: false, activation: false },
          },
        ],
        proposedEffects: [],
      },
    })
  ).aggregate;
  return { engine, run };
}

describe('Agent-authored Agent Definition governance', () => {
  it('launches the author specialization and materializes its successful result as Draft only', async () => {
    const { engine, run } = await completeAuthoringRun();

    expect(run.birth).toMatchObject({
      definition: { ref: 'agent-definition-author', version: 1 },
      runtime: { profileName: 'authoring-default' },
    });
    expect(run.task.payload).toMatchObject({
      kind: 'agent-definition-authoring-task',
      authoringBrief: {
        schemaVersion: 1,
        description: expect.stringContaining('support triage'),
        registry: { runtimeClasses: expect.any(Array), baseDefinitions: expect.any(Array) },
      },
    });
    expect(dispatchAgentRun).toHaveBeenCalledOnce();

    const callback = await finalizeAgentRunSource(pool, run.runId);
    expect(callback).toMatchObject({
      ok: true,
      deduplicated: false,
      entity: { properties: { node: 'draft-ready' } },
    });
    const sourceFields = (callback.ok && callback.entity.properties.fields) as Record<
      string,
      unknown
    >;
    expect(sourceFields.draftRel).toMatch(/^draft:/);
    const drafts = await listDrafts(pool, {
      owner: 'local-user',
      policyScope: 'governance',
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: 'agent-definition',
      target: 'support-triage',
      status: 'ready',
    });
    const runEntity = await getAgentRunEntity(
      pool,
      `agent-run:${run.runId}`,
      'local-user',
      'governance',
    );
    expect(runEntity?.links).toContainEqual({
      rel: ['draft'],
      href: `/_meta/api/entity?rel=${encodeURIComponent(`draft:${drafts[0]!.id}`)}`,
    });
    expect(
      await getActiveAgentDefinition(pool, 'support-triage', 'local-user', 'governance'),
    ).toBeUndefined();

    const projected = await getDraftMetaEntity(
      pool,
      engine,
      `draft:${drafts[0]!.id}`,
      'local-user',
      'governance',
      agentDefinitionDraftRegistryPort,
    );
    expect(projected?.properties).toMatchObject({
      validation: { valid: true },
      checks: expect.arrayContaining([expect.objectContaining({ pass: true })]),
      diff: expect.objectContaining({ hash: expect.stringMatching(/^[a-z0-9]+:/) }),
      evaluation: {
        refs: ['eval:support-triage@1'],
        payloads: { 'eval:support-triage@1': { variants: 5, passed: 5, safety: 1 } },
      },
    });
    await expect(finalizeAgentRunSource(pool, run.runId)).resolves.toMatchObject({
      ok: true,
      deduplicated: true,
    });
  });

  it('keeps a mechanically invalid Agent-authored candidate as a revisable Draft', async () => {
    const invalid = structuredClone(candidate);
    const taskBlock = invalid.prompt.blocks[1];
    if (taskBlock?.binding !== undefined) taskBlock.binding.pointer = '/undeclared';
    const { run } = await completeAuthoringRun(invalid);
    await expect(finalizeAgentRunSource(pool, run.runId)).resolves.toMatchObject({ ok: true });
    const drafts = await listDrafts(pool, {
      owner: 'local-user',
      policyScope: 'governance',
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: 'invalid', target: 'support-triage' });
    expect(
      await getActiveAgentDefinition(pool, 'support-triage', 'local-user', 'governance'),
    ).toBeUndefined();
  });

  it('denies Agent/system approval, permits a human activation, and preserves replay/CAS', async () => {
    const { engine, run } = await completeAuthoringRun();
    const callback = await finalizeAgentRunSource(pool, run.runId);
    if (!callback.ok) throw new Error(callback.reason);
    const draftRel = String(
      (callback.entity.properties.fields as Record<string, unknown>).draftRel,
    );
    const draftId = draftRel.slice('draft:'.length);
    const draft = await getDraft(pool, draftId, 'local-user', 'governance');
    expect(draft).toBeDefined();
    await expect(
      executeDraftMeta(
        pool,
        engine,
        {
          rel: draftRel,
          action: 'submit',
          actor: 'agent',
          principal: 'local-user',
          params: { commandId: 'submit:authoring-draft' },
        },
        { policyScope: 'governance', agentDefinitions: agentDefinitionDraftRegistryPort },
      ),
    ).resolves.toMatchObject({ kind: 'accepted' });
    const activationRel = `meta/activation:draft-${draftId}`;
    await expect(
      executeDraftMeta(
        pool,
        engine,
        {
          rel: activationRel,
          action: 'approve',
          actor: 'agent',
          principal: 'local-user',
          params: { commandId: 'approve-denied:agent-author' },
        },
        { policyScope: 'governance', agentDefinitions: agentDefinitionDraftRegistryPort },
      ),
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'actor-is-human=false' });
    await expect(
      executeDraftMeta(
        pool,
        engine,
        {
          rel: activationRel,
          action: 'approve',
          actor: 'agent',
          principal: 'system:capability:authoring',
          params: { commandId: 'approve-denied:system-author' },
        },
        { policyScope: 'governance', agentDefinitions: agentDefinitionDraftRegistryPort },
      ),
    ).resolves.toMatchObject({ kind: 'rejected' });
    const rejectionEvents = (await readLog(pool)).filter(
      (event) => event.kind === 'action-rejected' && event.rel === activationRel,
    );
    expect(rejectionEvents).toHaveLength(2);
    await expect(
      executeDraftMeta(
        pool,
        engine,
        {
          rel: activationRel,
          action: 'approve',
          actor: 'human',
          principal: 'local-user',
          params: { commandId: 'approve-human:authoring-draft' },
        },
        { policyScope: 'governance', agentDefinitions: agentDefinitionDraftRegistryPort },
      ),
    ).resolves.toMatchObject({ kind: 'accepted' });
    expect(
      await getActiveAgentDefinition(pool, 'support-triage', 'local-user', 'governance'),
    ).toMatchObject({ version: { ref: 'support-triage@1', status: 'active' } });
    expect((await getAgentRun(pool, run.runId, 'local-user', 'governance'))?.birth).toEqual(
      run.birth,
    );

    const eventCount = (await readLog(pool)).length;
    await rebuildDraftProjection(pool);
    await rebuildAgentDefinitionProjection(pool);
    expect((await readLog(pool)).length).toBe(eventCount);
    expect(
      await getActiveAgentDefinition(pool, 'support-triage', 'local-user', 'governance'),
    ).toMatchObject({ version: { ref: 'support-triage@1', status: 'active' } });
    expect((await getDraft(pool, draftId, 'local-user', 'governance'))?.aggregate.status).toBe(
      'accepted',
    );
  });
});
