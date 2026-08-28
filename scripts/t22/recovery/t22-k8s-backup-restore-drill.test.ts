import { describe, expect, it, vi } from 'vitest';

interface QuiescenceObservation {
  observedAt: string;
  workloads: Record<'web' | 'worker' | 'keycloak' | 'temporal', { desired: number; ready: number }>;
  runner: { daemonReplicas: number; activeRunJobs: number };
  postgres: { desired: number; ready: number };
  eventHighWaterMarks: [number, number];
}

interface KubernetesResourceIdentity {
  name: string;
  uid: string;
}

interface CurrentKubernetesTarget {
  namespace: KubernetesResourceIdentity;
  postgresService: KubernetesResourceIdentity & { clusterIp: string };
  claims: Array<KubernetesResourceIdentity & { volumeName: string }>;
  volumes: Array<KubernetesResourceIdentity & { hostPath: string; nodeName: string }>;
}

interface KubernetesDrillInput {
  backupId: string;
  drillId: string;
  gitSha: string;
  current: CurrentKubernetesTarget;
  target: {
    namespace: { name: string; exists: boolean; uid?: string };
    nodeName: string;
    root: string;
    existingResourceNames: string[];
  };
  quiescence: QuiescenceObservation;
}

interface RecoveryFingerprint {
  eventHighWaterMark: number;
  eventCount: number;
  eventDigest: string;
  payloadDigest: string;
  runEvidenceDigest: string;
  businessSnapshotHash: string;
  authoritativeHash: string;
}

interface KubernetesRecoveryDrillModule {
  planKubernetesRecoveryDrill(input: KubernetesDrillInput): {
    mode: 'isolated';
    destructive: false;
    source: {
      namespace: string;
      backupClaim: 'backup-data';
      backupReadOnly: true;
    };
    target: {
      namespace: string;
      labels: Record<string, string>;
      nodeName: string;
      postgresService: string;
      postgresServiceFqdn: string;
      volumes: Array<{ name: string; claimName: string; hostPath: string }>;
    };
    quiescenceReceipt: {
      verified: true;
      eventHighWaterMark: number;
      stopped: Record<'web' | 'worker' | 'runner' | 'keycloak' | 'temporal', true>;
    };
    phases: string[];
    commands: Array<{ phase: string; executable: string; args: string[] }>;
  };
  executeKubernetesRecoveryDrill(
    dependencies: {
      run(command: { executable: string; args: string[] }): Promise<{ exitCode: number }>;
    },
    input: KubernetesDrillInput,
  ): Promise<unknown>;
  buildKubernetesRecoveryEvidence(input: {
    plan: ReturnType<KubernetesRecoveryDrillModule['planKubernetesRecoveryDrill']>;
    source: RecoveryFingerprint;
    restored: RecoveryFingerprint;
    startedAt: string;
    readyAt: string;
    verifiedAt: string;
    targetNamespaceUid: string;
    targetPostgresServiceUid: string;
    targetClaimUids: Record<string, string>;
  }): Record<string, unknown>;
}

const plannedModulePath = './t22-k8s-backup-restore-drill';

async function plannedApi(): Promise<KubernetesRecoveryDrillModule> {
  return (await import(plannedModulePath)) as KubernetesRecoveryDrillModule;
}

const SHA = `sha256:${'a'.repeat(64)}`;

function currentTarget(): CurrentKubernetesTarget {
  return {
    namespace: { name: 'ui4a-system', uid: 'namespace-current-uid' },
    postgresService: {
      name: 'postgres',
      uid: 'postgres-current-service-uid',
      clusterIp: '10.103.150.84',
    },
    claims: [
      { name: 'postgres-data', uid: 'postgres-current-claim-uid', volumeName: 'ui4a-postgres-pv' },
      { name: 'runtime-data', uid: 'runtime-current-claim-uid', volumeName: 'ui4a-runtime-pv' },
      { name: 'backup-data', uid: 'backup-current-claim-uid', volumeName: 'ui4a-backup-pv' },
      { name: 'pki-data', uid: 'pki-current-claim-uid', volumeName: 'ui4a-pki-pv' },
    ],
    volumes: [
      {
        name: 'ui4a-postgres-pv',
        uid: 'postgres-current-volume-uid',
        hostPath: '/srv/ui4a/postgres',
        nodeName: 'k8s-w-2',
      },
      {
        name: 'ui4a-runtime-pv',
        uid: 'runtime-current-volume-uid',
        hostPath: '/srv/ui4a/runtime',
        nodeName: 'k8s-w-2',
      },
      {
        name: 'ui4a-backup-pv',
        uid: 'backup-current-volume-uid',
        hostPath: '/srv/ui4a/backup',
        nodeName: 'k8s-w-2',
      },
      {
        name: 'ui4a-pki-pv',
        uid: 'pki-current-volume-uid',
        hostPath: '/srv/ui4a/pki',
        nodeName: 'k8s-w-2',
      },
    ],
  };
}

function quiescence(overrides: Partial<QuiescenceObservation> = {}): QuiescenceObservation {
  return {
    observedAt: '2026-08-24T14:00:00.000Z',
    workloads: {
      web: { desired: 0, ready: 0 },
      worker: { desired: 0, ready: 0 },
      keycloak: { desired: 0, ready: 0 },
      temporal: { desired: 0, ready: 0 },
    },
    runner: { daemonReplicas: 0, activeRunJobs: 0 },
    postgres: { desired: 1, ready: 1 },
    eventHighWaterMarks: [42, 42],
    ...overrides,
  };
}

function drillInput(overrides: Partial<KubernetesDrillInput> = {}): KubernetesDrillInput {
  return {
    backupId: 'ui4a-v0.1.0-experimental.1-kubernetes-20260824T140000Z-abcdef0',
    drillId: '20260824t140000z-abcdef0',
    gitSha: 'abcdef0123456789',
    current: currentTarget(),
    target: {
      namespace: { name: 'ui4a-restore-abcdef0', exists: false },
      nodeName: 'k8s-w-2',
      root: '/srv/ui4a/restore-drills/20260824t140000z-abcdef0',
      existingResourceNames: [],
    },
    quiescence: quiescence(),
    ...overrides,
  };
}

function fingerprint(overrides: Partial<RecoveryFingerprint> = {}): RecoveryFingerprint {
  return {
    eventHighWaterMark: 42,
    eventCount: 42,
    eventDigest: SHA,
    payloadDigest: SHA,
    runEvidenceDigest: SHA,
    businessSnapshotHash: SHA,
    authoritativeHash: SHA,
    ...overrides,
  };
}

describe('T22 Kubernetes backup/restore drill safety plan', () => {
  it('derives quiescence only from stopped writers, zero active Runs, ready Postgres and stable HWM', async () => {
    const { planKubernetesRecoveryDrill } = await plannedApi();

    expect(planKubernetesRecoveryDrill(drillInput()).quiescenceReceipt).toEqual({
      verified: true,
      eventHighWaterMark: 42,
      stopped: { web: true, worker: true, runner: true, keycloak: true, temporal: true },
    });
  });

  it.each([
    [
      'a writer remains ready',
      () =>
        drillInput({
          quiescence: quiescence({
            workloads: { ...quiescence().workloads, worker: { desired: 1, ready: 1 } },
          }),
        }),
      'K8S_QUIESCENCE_NOT_ATTESTED',
    ],
    [
      'an Agent Run Job remains active',
      () =>
        drillInput({
          quiescence: quiescence({ runner: { daemonReplicas: 0, activeRunJobs: 1 } }),
        }),
      'K8S_QUIESCENCE_NOT_ATTESTED',
    ],
    [
      'the event high-water mark changes between reads',
      () => drillInput({ quiescence: quiescence({ eventHighWaterMarks: [42, 43] }) }),
      'K8S_EVENT_HWM_UNSTABLE',
    ],
    [
      'Postgres is unavailable',
      () =>
        drillInput({
          quiescence: quiescence({ postgres: { desired: 1, ready: 0 } }),
        }),
      'K8S_POSTGRES_NOT_READY',
    ],
  ])('fails before any process when %s', async (_case, input, code) => {
    const { executeKubernetesRecoveryDrill } = await plannedApi();
    const run = vi.fn(async () => ({ exitCode: 0 }));

    await expect(executeKubernetesRecoveryDrill({ run }, input())).rejects.toMatchObject({ code });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [
      'current namespace name',
      () =>
        drillInput({
          target: { ...drillInput().target, namespace: { name: 'ui4a-system', exists: true } },
        }),
    ],
    [
      'current namespace uid',
      () =>
        drillInput({
          target: {
            ...drillInput().target,
            namespace: {
              name: 'ui4a-restore-abcdef0',
              exists: true,
              uid: 'namespace-current-uid',
            },
          },
        }),
    ],
    [
      'an existing target resource',
      () =>
        drillInput({
          target: { ...drillInput().target, existingResourceNames: ['ui4a-postgres-pv'] },
        }),
    ],
    [
      'a current data root',
      () => drillInput({ target: { ...drillInput().target, root: '/srv/ui4a/postgres' } }),
    ],
    [
      'a child of a current data root',
      () => drillInput({ target: { ...drillInput().target, root: '/srv/ui4a/postgres/restore' } }),
    ],
    [
      'the current backup root',
      () => drillInput({ target: { ...drillInput().target, root: '/srv/ui4a/backup' } }),
    ],
  ])('rejects %s before any process can target current state', async (_case, input) => {
    const { executeKubernetesRecoveryDrill } = await plannedApi();
    const run = vi.fn(async () => ({ exitCode: 0 }));

    await expect(executeKubernetesRecoveryDrill({ run }, input())).rejects.toMatchObject({
      code: 'K8S_RESTORE_TARGET_NOT_ISOLATED',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('plans exact isolated namespace, static claims, service and ordered recovery phases', async () => {
    const { planKubernetesRecoveryDrill } = await plannedApi();

    const plan = planKubernetesRecoveryDrill(drillInput());
    expect(plan).toMatchObject({
      mode: 'isolated',
      destructive: false,
      source: { namespace: 'ui4a-system', backupClaim: 'backup-data', backupReadOnly: true },
      target: {
        namespace: 'ui4a-restore-abcdef0',
        labels: {
          'app.kubernetes.io/part-of': 'ui4a',
          'ui4a.io/recovery-drill': '20260824t140000z-abcdef0',
        },
        nodeName: 'k8s-w-2',
        postgresService: 'postgres-restore',
        postgresServiceFqdn: 'postgres-restore.ui4a-restore-abcdef0.svc.cluster.local',
        volumes: [
          {
            name: 'ui4a-restore-abcdef0-postgres-pv',
            claimName: 'postgres-restore-data',
            hostPath: '/srv/ui4a/restore-drills/20260824t140000z-abcdef0/postgres',
          },
          {
            name: 'ui4a-restore-abcdef0-runtime-pv',
            claimName: 'runtime-restore-data',
            hostPath: '/srv/ui4a/restore-drills/20260824t140000z-abcdef0/runtime',
          },
          {
            name: 'ui4a-restore-abcdef0-pki-pv',
            claimName: 'pki-restore-data',
            hostPath: '/srv/ui4a/restore-drills/20260824t140000z-abcdef0/pki',
          },
        ],
      },
      phases: [
        'attest-current-source',
        'quiesce-single-replica-writers',
        'attest-quiescence-and-source-fingerprint',
        'create-named-backup',
        'resume-current-source',
        'allocate-isolated-target',
        'restore-isolated-databases',
        'restore-isolated-private-files',
        'rebuild-isolated-projections',
        'capture-restored-fingerprint',
        'verify-rpo-rto',
      ],
    });
    expect(plan.commands.map(({ phase }) => phase)).toEqual(plan.phases);
    expect(plan.commands.every(({ args }) => Array.isArray(args) && args.length > 0)).toBe(true);
    expect(JSON.stringify(plan.commands)).not.toMatch(/sh -c|bash -c|--clean|ui4a-system.*delete/);
  });

  it('records source/restored digests, target resource identity and measured zero-event RPO', async () => {
    const { buildKubernetesRecoveryEvidence, planKubernetesRecoveryDrill } = await plannedApi();
    const plan = planKubernetesRecoveryDrill(drillInput());

    expect(
      buildKubernetesRecoveryEvidence({
        plan,
        source: fingerprint(),
        restored: fingerprint(),
        startedAt: '2026-08-24T14:05:00.000Z',
        readyAt: '2026-08-24T14:09:00.000Z',
        verifiedAt: '2026-08-24T14:11:00.000Z',
        targetNamespaceUid: 'restore-namespace-uid',
        targetPostgresServiceUid: 'restore-postgres-service-uid',
        targetClaimUids: {
          'postgres-restore-data': 'restore-postgres-claim-uid',
          'runtime-restore-data': 'restore-runtime-claim-uid',
          'pki-restore-data': 'restore-pki-claim-uid',
        },
      }),
    ).toMatchObject({
      schemaVersion: 1,
      mode: 'isolated',
      status: 'passed',
      authoritativeMatch: true,
      rpoEventDelta: 0,
      rpoCommittedEvents: 0,
      serviceRtoMs: 240_000,
      verifiedRtoMs: 360_000,
      sourceFingerprint: fingerprint(),
      restoredFingerprint: fingerprint(),
      targetAttestation: {
        namespace: { name: 'ui4a-restore-abcdef0', uid: 'restore-namespace-uid' },
        postgresService: { name: 'postgres-restore', uid: 'restore-postgres-service-uid' },
        claimUids: expect.objectContaining({
          'postgres-restore-data': 'restore-postgres-claim-uid',
        }),
      },
    });
  });
});
