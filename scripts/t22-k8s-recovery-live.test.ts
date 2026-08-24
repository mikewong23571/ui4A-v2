import { describe, expect, it, vi } from 'vitest';

import type { KubernetesDrillInput } from './t22-k8s-backup-restore-drill';
import {
  executeLiveKubernetesRecoveryDrill,
  type LiveRecoveryDependencies,
  type LiveRecoveryFingerprint,
} from './t22-k8s-recovery-live';

const SHA = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const requiredArtifacts = [
  'databases/keycloak.dump',
  'databases/temporal.dump',
  'databases/temporal_visibility.dump',
  'databases/ui4a.dump',
  'identity/deployment-bindings.json',
  'identity/realm-import.json',
  'identity/settings.json',
  'private/deployment-secrets.tar',
  'private/pki.tar',
  'runtime/workspaces.tar',
];

function artifact(ref: string) {
  return {
    digest: SHA,
    bytes: 1,
    kind: ref.startsWith('databases/')
      ? ('database' as const)
      : ref.startsWith('runtime/')
        ? ('runtime' as const)
        : ref === 'private/pki.tar'
          ? ('pki' as const)
          : ref.startsWith('private/')
            ? ('private-config' as const)
            : ('realm' as const),
    private:
      ref.startsWith('databases/') || ref.startsWith('runtime/') || ref.startsWith('private/'),
  };
}

function fingerprint(overrides: Partial<LiveRecoveryFingerprint> = {}): LiveRecoveryFingerprint {
  return {
    eventHighWaterMark: 43,
    eventCount: 43,
    eventDigest: SHA,
    payloadDigest: SHA,
    runEvidenceDigest: SHA,
    businessSnapshotHash: SHA,
    authoritativeHash: SHA,
    identityEvidenceDigest: SHA,
    ...overrides,
  };
}

function input(): KubernetesDrillInput {
  return {
    backupId: 'ui4a-v0.1.0-experimental.1-kubernetes-20260824T160000Z-376d4ef',
    drillId: 'ui4a-restore-20260824',
    gitSha: '376d4ef',
    current: {
      namespace: { name: 'ui4a-system', uid: 'namespace-current' },
      postgresService: { name: 'postgres', uid: 'service-current', clusterIp: '10.0.0.10' },
      claims: [
        { name: 'backup-data', uid: 'claim-backup', volumeName: 'ui4a-backup-pv' },
        { name: 'pki-data', uid: 'claim-pki', volumeName: 'ui4a-pki-pv' },
        { name: 'postgres-data', uid: 'claim-postgres', volumeName: 'ui4a-postgres-pv' },
        { name: 'runtime-data', uid: 'claim-runtime', volumeName: 'ui4a-runtime-pv' },
      ],
      volumes: [
        {
          name: 'ui4a-backup-pv',
          uid: 'volume-backup',
          hostPath: '/srv/ui4a/backup',
          nodeName: 'k8s-w-2',
        },
        {
          name: 'ui4a-pki-pv',
          uid: 'volume-pki',
          hostPath: '/srv/ui4a/pki',
          nodeName: 'k8s-w-2',
        },
        {
          name: 'ui4a-postgres-pv',
          uid: 'volume-postgres',
          hostPath: '/srv/ui4a/postgres',
          nodeName: 'k8s-w-2',
        },
        {
          name: 'ui4a-runtime-pv',
          uid: 'volume-runtime',
          hostPath: '/srv/ui4a/runtime',
          nodeName: 'k8s-w-2',
        },
      ],
    },
    target: {
      namespace: { name: 'ui4a-restore-20260824', exists: false },
      nodeName: 'k8s-w-2',
      root: '/srv/ui4a/recovery/ui4a-restore-20260824',
      existingResourceNames: [],
    },
    quiescence: {
      observedAt: '2026-08-24T16:00:00.000Z',
      workloads: {
        web: { desired: 0, ready: 0 },
        worker: { desired: 0, ready: 0 },
        keycloak: { desired: 0, ready: 0 },
        temporal: { desired: 0, ready: 0 },
      },
      runner: { daemonReplicas: 0, activeRunJobs: 0 },
      postgres: { desired: 1, ready: 1 },
      eventHighWaterMarks: [43, 43],
    },
  };
}

function dependencies(): LiveRecoveryDependencies {
  const current = input().current;
  return {
    attestCurrent: vi.fn(async () => structuredClone(current)),
    quiesceCurrent: vi.fn(async () => undefined),
    observeQuiescence: vi.fn(async () => structuredClone(input().quiescence)),
    captureSourceFingerprint: vi.fn(async () => fingerprint()),
    createBackup: vi.fn(async () => ({
      backupId: input().backupId,
      completedAt: '2026-08-24T16:01:00.000Z',
      manifestDigest: SHA,
      artifacts: Object.fromEntries(requiredArtifacts.map((ref) => [ref, artifact(ref)])),
    })),
    resumeCurrent: vi.fn(async () => undefined),
    allocateIsolatedTarget: vi.fn(async () => ({
      namespaceUid: 'namespace-restored',
      postgresServiceUid: 'service-restored',
      claimUids: {
        'pki-restore-data': 'claim-restored-pki',
        'postgres-restore-data': 'claim-restored-postgres',
        'runtime-restore-data': 'claim-restored-runtime',
      },
      volumeUids: {
        'ui4a-restore-20260824-pki-pv': 'volume-restored-pki',
        'ui4a-restore-20260824-postgres-pv': 'volume-restored-postgres',
        'ui4a-restore-20260824-runtime-pv': 'volume-restored-runtime',
      },
      root: '/srv/ui4a/recovery/ui4a-restore-20260824',
    })),
    restoreIsolatedTarget: vi.fn(async () => ({
      startedAt: '2026-08-24T16:02:00.000Z',
      readyAt: '2026-08-24T16:04:30.000Z',
      checksumsVerified: true as const,
    })),
    rebuildIsolatedProjections: vi.fn(async () => ({ completed: true as const })),
    captureRestoredFingerprint: vi.fn(async () => fingerprint()),
    clock: vi.fn(() => '2026-08-24T16:05:00.000Z'),
  };
}

describe('T22 live Kubernetes isolated recovery orchestration', () => {
  it('executes backup, isolated restore and rebuild with RPO/RTO evidence', async () => {
    const deps = dependencies();
    const result = await executeLiveKubernetesRecoveryDrill(deps, input());

    expect(result).toMatchObject({
      ok: true,
      code: 'K8S_LIVE_RECOVERY_COMPLETED',
      evidence: {
        rpoEvents: 0,
        rtoMilliseconds: 150_000,
        authoritativeMatch: true,
        identityMatch: true,
        runEvidenceMatch: true,
        checksumsVerified: true,
        currentTargetPreserved: true,
      },
    });
    expect(deps.quiesceCurrent).toHaveBeenCalledOnce();
    expect(deps.resumeCurrent).toHaveBeenCalledOnce();
    expect(deps.rebuildIsolatedProjections).toHaveBeenCalledOnce();
  });

  it('always resumes current writers when named backup fails', async () => {
    const deps = dependencies();
    vi.mocked(deps.createBackup).mockRejectedValue(new Error('failed'));

    await expect(executeLiveKubernetesRecoveryDrill(deps, input())).rejects.toMatchObject({
      code: 'K8S_LIVE_BACKUP_FAILED',
    });
    expect(deps.resumeCurrent).toHaveBeenCalledOnce();
    expect(deps.allocateIsolatedTarget).not.toHaveBeenCalled();
  });

  it('binds the plan and source fingerprint to the post-quiescence observation', async () => {
    const deps = dependencies();
    const staleInput = input();
    staleInput.quiescence.eventHighWaterMarks = [1, 1];

    const result = await executeLiveKubernetesRecoveryDrill(deps, staleInput);

    expect(result).toMatchObject({ ok: true, code: 'K8S_LIVE_RECOVERY_COMPLETED' });
    expect(deps.createBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          quiescenceReceipt: expect.objectContaining({ eventHighWaterMark: 43 }),
        }),
      }),
    );
  });

  it('rejects a completed backup missing any required checksummed artifact', async () => {
    const deps = dependencies();
    vi.mocked(deps.createBackup).mockResolvedValue({
      backupId: input().backupId,
      completedAt: '2026-08-24T16:01:00.000Z',
      manifestDigest: SHA,
      artifacts: Object.fromEntries(requiredArtifacts.slice(1).map((ref) => [ref, artifact(ref)])),
    });

    await expect(executeLiveKubernetesRecoveryDrill(deps, input())).rejects.toMatchObject({
      code: 'K8S_LIVE_BACKUP_INCOMPLETE',
    });
    expect(deps.resumeCurrent).toHaveBeenCalledOnce();
    expect(deps.allocateIsolatedTarget).not.toHaveBeenCalled();
  });

  it('rejects checksum rows without exact kind, byte count and privacy metadata', async () => {
    const deps = dependencies();
    const artifacts = Object.fromEntries(requiredArtifacts.map((ref) => [ref, artifact(ref)]));
    artifacts['private/pki.tar'] = {
      ...artifacts['private/pki.tar']!,
      bytes: -1,
      kind: 'realm',
      private: false,
    };
    vi.mocked(deps.createBackup).mockResolvedValue({
      backupId: input().backupId,
      completedAt: '2026-08-24T16:01:00.000Z',
      manifestDigest: SHA,
      artifacts,
    });

    await expect(executeLiveKubernetesRecoveryDrill(deps, input())).rejects.toMatchObject({
      code: 'K8S_LIVE_BACKUP_INCOMPLETE',
    });
  });

  it('fails closed when target attestation aliases a current UID or root', async () => {
    const deps = dependencies();
    vi.mocked(deps.allocateIsolatedTarget).mockResolvedValue({
      namespaceUid: 'namespace-current',
      postgresServiceUid: 'service-restored',
      claimUids: {
        'pki-restore-data': 'claim-restored-pki',
        'postgres-restore-data': 'claim-restored-postgres',
        'runtime-restore-data': 'claim-restored-runtime',
      },
      volumeUids: {
        'ui4a-restore-20260824-pki-pv': 'volume-restored-pki',
        'ui4a-restore-20260824-postgres-pv': 'volume-restored-postgres',
        'ui4a-restore-20260824-runtime-pv': 'volume-restored-runtime',
      },
      root: '/srv/ui4a/postgres',
    });

    await expect(executeLiveKubernetesRecoveryDrill(deps, input())).rejects.toMatchObject({
      code: 'K8S_LIVE_TARGET_NOT_ISOLATED',
    });
    expect(deps.restoreIsolatedTarget).not.toHaveBeenCalled();
  });

  it('rejects authority, identity or Run drift after projection rebuild', async () => {
    const deps = dependencies();
    vi.mocked(deps.captureRestoredFingerprint).mockResolvedValue(
      fingerprint({ identityEvidenceDigest: SHA_B }),
    );

    await expect(executeLiveKubernetesRecoveryDrill(deps, input())).rejects.toMatchObject({
      code: 'K8S_LIVE_RECOVERY_MISMATCH',
    });
    expect(deps.rebuildIsolatedProjections).toHaveBeenCalledOnce();
  });

  it('re-attests every current UID after restore and rejects any replacement', async () => {
    const deps = dependencies();
    vi.mocked(deps.attestCurrent)
      .mockResolvedValueOnce(structuredClone(input().current))
      .mockResolvedValueOnce({
        ...structuredClone(input().current),
        postgresService: {
          ...input().current.postgresService,
          uid: 'unexpected-replacement',
        },
      });

    await expect(executeLiveKubernetesRecoveryDrill(deps, input())).rejects.toMatchObject({
      code: 'K8S_LIVE_CURRENT_TARGET_CHANGED',
    });
  });
});
