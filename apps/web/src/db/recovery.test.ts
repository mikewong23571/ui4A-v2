import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveAgentDefinition,
  type AgentRunBirthReferences,
  type AgentRunCommand,
  type AgentTaskEnvelope,
  type CapabilityRunCommand,
  type DraftCommand,
  type UserSidecarKey,
} from '@ui4a/engine';
import type { AgentDefinitionSource, JsonValue } from '@ui4a/shared';

import { ensureAgentDefinitionTables, installSeedAgentDefinition } from './agent-definitions';
import { appendAgentRunCommand, ensureAgentRunTables, storeAgentRunPayload } from './agent-runs';
import {
  appendCapabilityRawEvent,
  appendCapabilityRunCommand,
  ensureCapabilityRunTables,
} from './capability-runs';
import { appendDraftCommand, ensureDraftTables, payloadSha256 } from './drafts';
import { appendEvent, ensureEventsTable } from './events';
import { getPool } from './pool';
import { appendSidecarCommand, ensurePresentationTables } from './presentation';

interface ScriptCompatibleRecoveryFingerprint {
  schemaVersion: 1;
  eventHighWaterMark: number;
  eventCount: number;
  eventDigest: string;
  payloadDigest: string;
  runEvidenceDigest: string;
  businessSnapshotHash: string;
  authoritativeHash: string;
  projectionsExcluded: true;
}

interface RecoveryModule {
  captureUi4aRecoveryFingerprint(
    db: typeof pool,
    input: { businessSnapshot: unknown },
  ): Promise<ScriptCompatibleRecoveryFingerprint>;
  captureUi4aProjectionFingerprint(db: typeof pool): Promise<string>;
  rebuildAllUi4aProjections(db: typeof pool): Promise<void>;
}

const plannedModulePath = './recovery';

async function recoveryApi(): Promise<RecoveryModule> {
  return (await import(plannedModulePath)) as RecoveryModule;
}

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';
if (new URL(TEST_DATABASE_URL).pathname !== '/ui4a_test') {
  throw new Error('recovery tests require the isolated ui4a_test database');
}
const pool = getPool(TEST_DATABASE_URL);
const SECRET_CANARY = '__recovery_secret_must_not_escape__';

const capabilityCreate = {
  kind: 'create',
  eventId: 'event:recovery:capability:create',
  commandId: 'command:recovery:capability:create',
  runId: 'recovery-capability-1',
  principal: 'user:recovery',
  policyScope: 'development',
  source: { rel: 'recovery:fixture', action: 'run', eventId: 'core:recovery:1' },
  profileName: 'recovery-profile',
  task: {
    schemaVersion: 1,
    repositoryRef: 'repo:recovery',
    baseRevision: 'a'.repeat(40),
    goal: 'verify recovery',
    constraints: [],
    acceptanceCriteria: ['fingerprints match'],
    allowedPaths: ['apps/web/src/db'],
    budget: {
      timeoutSeconds: 300,
      maxTurns: 20,
      maxRawEvents: 10,
      maxRawBytes: 65_536,
      maxRawChunkBytes: 16_384,
    },
    redaction: { secretNames: ['RECOVERY_TEST_SECRET'], redactHostPaths: true },
  },
} satisfies CapabilityRunCommand;

const birth: AgentRunBirthReferences = {
  schemaVersion: 1,
  kind: 'event-native',
  definition: {
    ref: 'recovery-writer@1',
    version: 1,
    sourceHash: 'sha256:recovery-definition-source',
    parentHashes: [],
    flattenedHash: 'sha256:recovery-definition-flat',
  },
  prompt: { templateHash: 'sha256:recovery-template', compiledHash: 'sha256:recovery-compiled' },
  runtime: {
    profileName: 'document-recovery',
    profileVersion: '1',
    adapterVersion: 'host-v1',
  },
  taskContract: { ref: 'writing-task@1', hash: 'sha256:recovery-task-contract' },
  resultContract: { ref: 'writing-result@1', hash: 'sha256:recovery-result-contract' },
};

const task: AgentTaskEnvelope = {
  schemaVersion: 1,
  contract: birth.taskContract,
  payload: { brief: 'Verify recovery consistency.' },
  contextRefs: ['entity:recovery'],
};

const nativeCreate = {
  kind: 'create',
  eventId: 'event:recovery:agent-run:create',
  commandId: 'command:recovery:agent-run:create',
  runId: 'recovery-agent-run-1',
  principal: 'user:recovery',
  policyScope: 'development',
  source: {
    rel: 'recovery:fixture',
    action: 'write',
    eventId: 'core:recovery:2',
    onDoneAction: 'receive',
    onErrorAction: 'fail',
  },
  birth,
  task,
} satisfies AgentRunCommand;

const definition: AgentDefinitionSource = {
  schemaVersion: 1,
  ref: 'recovery-writer@1',
  name: 'recovery-writer',
  version: 1,
  intent: 'Write recovery evidence.',
  prompt: {
    schemaVersion: 1,
    blocks: [
      {
        id: 'authority',
        role: 'system',
        purpose: 'authority',
        literal: 'Produce bounded recovery evidence.',
        sealed: true,
      },
    ],
  },
  contracts: {
    inputSchema: { type: 'object', properties: { brief: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { markdown: { type: 'string' } } },
  },
  runtimeRequirements: { class: 'document-agent', features: ['structured-events'] },
  policies: {
    tools: { allowed: ['documents.read'] },
    context: { allowedSources: ['entity'], maxItems: 5 },
    resources: { allowed: ['document-workspace'] },
    artifacts: { allowedMediaTypes: ['text/markdown'], maxCount: 2, maxBytes: 16_384 },
  },
  evaluationPolicy: {
    verifiers: ['citation-check'],
    evalSuiteRefs: ['eval-suite:recovery'],
    minimumScore: 0.8,
  },
};

const sidecarKey: UserSidecarKey = {
  principal: 'user:recovery',
  policyScope: 'development',
  subject: 'recovery:fixture',
  intent: 'inspect',
  deviceClass: 'wide',
};

const sidecarVersion = {
  surface: {
    schemaVersion: 1 as const,
    root: {
      kind: 'diagnostic' as const,
      id: 'recovery-root',
      role: 'diagnostic' as const,
      code: 'recovery-fixture',
      dependencies: [],
      provenance: [{ kind: 'generic-fallback' as const, ref: 'recovery-fixture' }],
    },
  },
  dependencies: [],
  provenance: { kind: 'generic-fallback' as const, ref: 'recovery-fixture' },
  changedPaths: [],
};

async function clearFixture(): Promise<void> {
  await pool.query(
    `TRUNCATE presentation_user_sidecars,
      agent_run_projection_state, agent_run_projection, agent_run_payloads,
      agent_definition_active, agent_definition_versions, agent_definition_payloads,
      capability_run_projection, capability_payloads,
      draft_projection, draft_payloads, events`,
  );
}

async function seedFixture(): Promise<void> {
  await appendEvent(pool, {
    domain: 'core',
    kind: 'seed',
    rel: 'recovery:fixture',
    actor: 'human',
    principal: 'user:recovery',
    channel: 'fixture',
    detail: { node: 'ready' },
  });
  const draftPayload = { name: 'recovery-flow', nodes: [] };
  const draftCommand: DraftCommand = {
    kind: 'create',
    eventId: 'event:recovery:draft:create',
    commandId: 'command:recovery:draft:create',
    draftId: 'recovery-draft-1',
    owner: 'user:recovery',
    policyScope: 'development',
    draftKind: 'flow-definition',
    target: 'recovery-flow',
    baseVersion: '1',
    payloadHash: payloadSha256(draftPayload),
    schemaRef: 'ui4a://flow-definition/v1',
    provenance: {
      actor: 'agent',
      principal: 'user:recovery',
      commandId: 'command:recovery:draft:create',
      sources: ['recovery:fixture'],
    },
    validation: { valid: false, issues: [] },
  };
  await appendDraftCommand(pool, draftCommand, draftPayload);
  await appendCapabilityRunCommand(pool, capabilityCreate);
  vi.stubEnv('RECOVERY_TEST_SECRET', SECRET_CANARY);
  await appendCapabilityRawEvent(pool, {
    runId: capabilityCreate.runId,
    principal: capabilityCreate.principal,
    policyScope: capabilityCreate.policyScope,
    ordinal: 1,
    payload: { token: SECRET_CANARY, cwd: '/private/recovery/workspace' },
    workspacePath: '/private/recovery',
    redaction: capabilityCreate.task.redaction,
  });
  await installSeedAgentDefinition(pool, {
    principal: 'user:recovery',
    policyScope: 'development',
    source: definition,
    artifact: resolveAgentDefinition(definition, new Map()),
    evalEvidence: { suiteRef: 'eval-suite:recovery', passed: true, score: 1 } as JsonValue,
  });
  await appendAgentRunCommand(pool, nativeCreate);
  await storeAgentRunPayload(pool, { markdown: '# Recovery evidence' }, 'application/json');
  await appendSidecarCommand(pool, {
    kind: 'instantiate',
    eventId: 'event:recovery:sidecar:create',
    commandId: 'command:recovery:sidecar:create',
    sidecarId: 'recovery-sidecar-1',
    key: sidecarKey,
    version: sidecarVersion,
  });
}

beforeAll(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await ensureCapabilityRunTables(pool);
  await ensureAgentDefinitionTables(pool);
  await ensureAgentRunTables(pool);
  await ensurePresentationTables(pool);
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  await clearFixture();
  await seedFixture();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await clearFixture();
});

describe.sequential('UI4A recovery consistency', () => {
  it('captures stable script-compatible authority without payload or Secret disclosure', async () => {
    const { captureUi4aRecoveryFingerprint } = await recoveryApi();
    const businessSnapshot = { instances: { 'recovery:fixture': { node: 'ready' } } };

    const first = await captureUi4aRecoveryFingerprint(pool, { businessSnapshot });
    const second = await captureUi4aRecoveryFingerprint(pool, { businessSnapshot });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: 1,
      projectionsExcluded: true,
      eventCount: expect.any(Number),
      eventHighWaterMark: expect.any(Number),
      eventDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      payloadDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      runEvidenceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      businessSnapshotHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      authoritativeHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    } satisfies Partial<ScriptCompatibleRecoveryFingerprint>);
    expect(first.eventCount).toBeGreaterThan(5);
    expect(JSON.stringify(first)).not.toContain(SECRET_CANARY);
  });

  it('changes authority for event, payload, Run, and business evidence independently', async () => {
    const { captureUi4aRecoveryFingerprint } = await recoveryApi();
    const businessSnapshot = { instances: { 'recovery:fixture': { node: 'ready' } } };
    const baseline = await captureUi4aRecoveryFingerprint(pool, { businessSnapshot });

    await appendEvent(pool, {
      domain: 'core',
      kind: 'action-rejected',
      rel: 'recovery:fixture',
      actor: 'human',
      principal: 'user:recovery',
      channel: 'fixture',
      reason: 'recovery-fixture-rejection',
    });
    const eventChanged = await captureUi4aRecoveryFingerprint(pool, { businessSnapshot });
    expect(eventChanged.eventDigest).not.toBe(baseline.eventDigest);
    expect(eventChanged.authoritativeHash).not.toBe(baseline.authoritativeHash);
    expect(eventChanged.payloadDigest).toBe(baseline.payloadDigest);
    expect(eventChanged.runEvidenceDigest).toBe(baseline.runEvidenceDigest);

    await storeAgentRunPayload(pool, { markdown: '# Additional evidence' }, 'application/json');
    const payloadChanged = await captureUi4aRecoveryFingerprint(pool, { businessSnapshot });
    expect(payloadChanged.eventDigest).toBe(eventChanged.eventDigest);
    expect(payloadChanged.payloadDigest).not.toBe(eventChanged.payloadDigest);
    expect(payloadChanged.authoritativeHash).not.toBe(eventChanged.authoritativeHash);

    await appendEvent(pool, {
      domain: 'capability',
      kind: 'agent-run-preparing',
      rel: 'agent-run:recovery-evidence-only',
      actor: 'agent',
      principal: 'user:recovery',
      channel: 'capability',
      detail: { runId: 'recovery-evidence-only', revision: 1 },
    });
    const runChanged = await captureUi4aRecoveryFingerprint(pool, { businessSnapshot });
    expect(runChanged.runEvidenceDigest).not.toBe(payloadChanged.runEvidenceDigest);
    expect(runChanged.authoritativeHash).not.toBe(payloadChanged.authoritativeHash);

    const businessChanged = await captureUi4aRecoveryFingerprint(pool, {
      businessSnapshot: { instances: { 'recovery:fixture': { node: 'changed' } } },
    });
    expect(businessChanged.eventDigest).toBe(runChanged.eventDigest);
    expect(businessChanged.payloadDigest).toBe(runChanged.payloadDigest);
    expect(businessChanged.runEvidenceDigest).toBe(runChanged.runEvidenceDigest);
    expect(businessChanged.businessSnapshotHash).not.toBe(runChanged.businessSnapshotHash);
    expect(businessChanged.authoritativeHash).not.toBe(runChanged.authoritativeHash);
  });

  it('rebuilds every projection without changing events, payloads, Runs, or business authority', async () => {
    const {
      captureUi4aProjectionFingerprint,
      captureUi4aRecoveryFingerprint,
      rebuildAllUi4aProjections,
    } = await recoveryApi();
    const businessSnapshot = { instances: { 'recovery:fixture': { node: 'ready' } } };
    const source = await captureUi4aRecoveryFingerprint(pool, { businessSnapshot });
    const sourceProjectionHash = await captureUi4aProjectionFingerprint(pool);

    await pool.query(
      `TRUNCATE presentation_user_sidecars,
        agent_run_projection_state, agent_run_projection,
        agent_definition_active, agent_definition_versions,
        capability_run_projection, draft_projection`,
    );
    expect(await captureUi4aProjectionFingerprint(pool)).not.toBe(sourceProjectionHash);

    await rebuildAllUi4aProjections(pool);

    const restored = await captureUi4aRecoveryFingerprint(pool, { businessSnapshot });
    expect(await captureUi4aProjectionFingerprint(pool)).toBe(sourceProjectionHash);
    expect(restored).toEqual(source);
    expect(restored).toMatchObject({
      eventCount: source.eventCount,
      eventHighWaterMark: source.eventHighWaterMark,
      eventDigest: source.eventDigest,
      payloadDigest: source.payloadDigest,
      runEvidenceDigest: source.runEvidenceDigest,
      businessSnapshotHash: source.businessSnapshotHash,
      authoritativeHash: source.authoritativeHash,
    });
  });
});
