import { describe, expect, it } from 'vitest';

interface RecoveryInput {
  events: Array<{ seq: number; domain: string; kind: string; detail: unknown }>;
  payloads: Array<{ table: string; hash: string; bytes: number }>;
  runs: Array<{
    runId: string;
    status: string;
    birthRef: string;
    resultRef?: string;
    artifactRefs: string[];
  }>;
  businessSnapshot: unknown;
  projections?: Record<string, unknown>;
}

interface RecoveryFingerprint {
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

interface RecoveryComparison {
  authoritativeMatch: boolean;
  rpoEventDelta: number;
  rpoCommittedEvents: number;
  serviceRtoMs: number;
  verifiedRtoMs: number;
}

interface RecoveryFingerprintModule {
  buildRecoveryFingerprint(input: RecoveryInput): RecoveryFingerprint;
  compareRecoveryFingerprints(input: {
    source: RecoveryFingerprint;
    restored: RecoveryFingerprint;
    restoreStartedAt: string;
    readyAt: string;
    verifiedAt: string;
  }): RecoveryComparison;
}

const plannedModulePath = './t22-recovery-fingerprint';

async function plannedApi(): Promise<RecoveryFingerprintModule> {
  return (await import(plannedModulePath)) as RecoveryFingerprintModule;
}

function fixture(): RecoveryInput {
  return {
    events: [
      { seq: 2, domain: 'capability', kind: 'agent-run-succeeded', detail: { runId: 'run-1' } },
      { seq: 1, domain: 'core', kind: 'seed', detail: { rel: 'seed:main' } },
    ],
    payloads: [
      { table: 'agent_run_payloads', hash: `sha256:${'b'.repeat(64)}`, bytes: 20 },
      { table: 'draft_payloads', hash: `sha256:${'a'.repeat(64)}`, bytes: 10 },
    ],
    runs: [
      {
        runId: 'run-1',
        status: 'succeeded',
        birthRef: 'coding-agent@1',
        resultRef: `sha256:${'c'.repeat(64)}`,
        artifactRefs: ['artifact:patch', 'artifact:trajectory'],
      },
    ],
    businessSnapshot: { instances: { 'post:first': { node: 'published' } } },
    projections: { draft_projection: [{ id: 'projection-only' }] },
  };
}

function reordered(input: RecoveryInput): RecoveryInput {
  return {
    ...input,
    events: [...input.events].reverse(),
    payloads: [...input.payloads].reverse(),
    runs: input.runs.map((run) => ({ ...run, artifactRefs: [...run.artifactRefs].reverse() })),
    businessSnapshot: { instances: { 'post:first': { node: 'published' } } },
    projections: { draft_projection: [{ id: 'different-projection' }] },
  };
}

describe('T22 recovery fingerprint and measured recovery evidence', () => {
  it('is stable under input ordering and excludes rebuildable projections from authority', async () => {
    const { buildRecoveryFingerprint } = await plannedApi();
    const source = fixture();

    expect(buildRecoveryFingerprint(reordered(source))).toEqual(buildRecoveryFingerprint(source));
    expect(buildRecoveryFingerprint(source)).toMatchObject({
      schemaVersion: 1,
      eventHighWaterMark: 2,
      eventCount: 2,
      projectionsExcluded: true,
      eventDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      payloadDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      runEvidenceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      businessSnapshotHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      authoritativeHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it.each(['events', 'payloads', 'runs', 'businessSnapshot'] as const)(
    'changes authoritative identity when %s changes',
    async (field) => {
      const { buildRecoveryFingerprint } = await plannedApi();
      const source = fixture();
      const changed = fixture();
      if (field === 'events') changed.events[0]!.detail = { runId: 'run-changed' };
      if (field === 'payloads') changed.payloads[0]!.bytes += 1;
      if (field === 'runs') changed.runs[0]!.status = 'failed';
      if (field === 'businessSnapshot') {
        changed.businessSnapshot = { instances: { 'post:first': { node: 'draft' } } };
      }

      expect(buildRecoveryFingerprint(changed).authoritativeHash).not.toBe(
        buildRecoveryFingerprint(source).authoritativeHash,
      );
    },
  );

  it('reports exact committed-event RPO and service/verified RTO from restored evidence', async () => {
    const { buildRecoveryFingerprint, compareRecoveryFingerprints } = await plannedApi();
    const source = buildRecoveryFingerprint(fixture());
    const restored = buildRecoveryFingerprint(fixture());

    expect(
      compareRecoveryFingerprints({
        source,
        restored,
        restoreStartedAt: '2026-08-24T12:00:00.000Z',
        readyAt: '2026-08-24T12:03:00.000Z',
        verifiedAt: '2026-08-24T12:05:30.000Z',
      }),
    ).toEqual({
      authoritativeMatch: true,
      rpoEventDelta: 0,
      rpoCommittedEvents: 0,
      serviceRtoMs: 180_000,
      verifiedRtoMs: 330_000,
    });
  });

  it('does not call projection drift data loss and reports actual missing committed events', async () => {
    const { buildRecoveryFingerprint, compareRecoveryFingerprints } = await plannedApi();
    const source = buildRecoveryFingerprint(fixture());
    const missingEvent = fixture();
    missingEvent.events = missingEvent.events.filter(({ seq }) => seq !== 2);
    const restored = buildRecoveryFingerprint(missingEvent);

    expect(
      compareRecoveryFingerprints({
        source,
        restored,
        restoreStartedAt: '2026-08-24T12:00:00.000Z',
        readyAt: '2026-08-24T12:01:00.000Z',
        verifiedAt: '2026-08-24T12:02:00.000Z',
      }),
    ).toMatchObject({
      authoritativeMatch: false,
      rpoEventDelta: 1,
      rpoCommittedEvents: 1,
    });
  });
});
