import { resolve, sep } from 'node:path';

import {
  planKubernetesRecoveryDrill,
  type CurrentKubernetesTarget,
  type KubernetesDrillInput,
  type KubernetesRecoveryPlan,
  type QuiescenceObservation,
} from './t22-k8s-backup-restore-drill';

const digestPattern = /^sha256:[0-9a-f]{64}$/;

export const liveRecoveryArtifactRefs = [
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
] as const;

export interface LiveRecoveryFingerprint {
  eventHighWaterMark: number;
  eventCount: number;
  eventDigest: string;
  payloadDigest: string;
  runEvidenceDigest: string;
  businessSnapshotHash: string;
  authoritativeHash: string;
  identityEvidenceDigest: string;
}

export interface CompletedKubernetesBackup {
  backupId: string;
  completedAt: string;
  manifestDigest: string;
  artifacts: Record<string, string>;
}

export interface IsolatedTargetAttestation {
  namespaceUid: string;
  postgresServiceUid: string;
  claimUids: Record<string, string>;
  volumeUids: Record<string, string>;
  root: string;
}

export interface LiveRecoveryDependencies {
  attestCurrent(): Promise<CurrentKubernetesTarget>;
  quiesceCurrent(plan: KubernetesRecoveryPlan): Promise<void>;
  observeQuiescence(): Promise<QuiescenceObservation>;
  captureSourceFingerprint(): Promise<LiveRecoveryFingerprint>;
  createBackup(input: {
    plan: KubernetesRecoveryPlan;
    source: LiveRecoveryFingerprint;
  }): Promise<CompletedKubernetesBackup>;
  resumeCurrent(plan: KubernetesRecoveryPlan): Promise<void>;
  allocateIsolatedTarget(plan: KubernetesRecoveryPlan): Promise<IsolatedTargetAttestation>;
  restoreIsolatedTarget(input: {
    plan: KubernetesRecoveryPlan;
    backup: CompletedKubernetesBackup;
    target: IsolatedTargetAttestation;
  }): Promise<{ startedAt: string; readyAt: string; checksumsVerified: true }>;
  rebuildIsolatedProjections(input: {
    plan: KubernetesRecoveryPlan;
    target: IsolatedTargetAttestation;
  }): Promise<{ completed: true }>;
  captureRestoredFingerprint(input: {
    plan: KubernetesRecoveryPlan;
    target: IsolatedTargetAttestation;
  }): Promise<LiveRecoveryFingerprint>;
  clock(): string;
}

export type LiveRecoveryErrorCode =
  | 'K8S_LIVE_CURRENT_TARGET_CHANGED'
  | 'K8S_LIVE_QUIESCENCE_INVALID'
  | 'K8S_LIVE_SOURCE_FINGERPRINT_INVALID'
  | 'K8S_LIVE_BACKUP_FAILED'
  | 'K8S_LIVE_BACKUP_INCOMPLETE'
  | 'K8S_LIVE_CURRENT_RESUME_FAILED'
  | 'K8S_LIVE_TARGET_NOT_ISOLATED'
  | 'K8S_LIVE_RESTORE_FAILED'
  | 'K8S_LIVE_PROJECTION_REBUILD_FAILED'
  | 'K8S_LIVE_RECOVERY_MISMATCH';

export class LiveRecoveryError extends Error {
  constructor(readonly code: LiveRecoveryErrorCode) {
    super(code);
    this.name = 'LiveRecoveryError';
  }
}

function fail(code: LiveRecoveryErrorCode): never {
  throw new LiveRecoveryError(code);
}

function canonicalCurrent(value: CurrentKubernetesTarget): string {
  return JSON.stringify({
    namespace: value.namespace,
    postgresService: value.postgresService,
    claims: value.claims
      .map(({ name, uid, volumeName }) => ({ name, uid, volumeName }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    volumes: value.volumes
      .map(({ name, uid, hostPath, nodeName }) => ({ name, uid, hostPath, nodeName }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  });
}

function validTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function validFingerprint(value: LiveRecoveryFingerprint): boolean {
  return (
    Number.isSafeInteger(value.eventHighWaterMark) &&
    value.eventHighWaterMark >= 0 &&
    Number.isSafeInteger(value.eventCount) &&
    value.eventCount >= 0 &&
    [
      value.eventDigest,
      value.payloadDigest,
      value.runEvidenceDigest,
      value.businessSnapshotHash,
      value.authoritativeHash,
      value.identityEvidenceDigest,
    ].every((digest) => digestPattern.test(digest))
  );
}

function validateBackup(backup: CompletedKubernetesBackup, plan: KubernetesRecoveryPlan): void {
  const refs = Object.keys(backup.artifacts).sort();
  if (
    backup.backupId !== plan.backupId ||
    !validTimestamp(backup.completedAt) ||
    !digestPattern.test(backup.manifestDigest) ||
    refs.join(',') !== [...liveRecoveryArtifactRefs].sort().join(',') ||
    Object.values(backup.artifacts).some((digest) => !digestPattern.test(digest))
  ) {
    fail('K8S_LIVE_BACKUP_INCOMPLETE');
  }
}

function childOrEqual(candidate: string, parent: string): boolean {
  const child = resolve(candidate);
  const root = resolve(parent);
  return child === root || child.startsWith(`${root}${sep}`);
}

function validateTarget(
  target: IsolatedTargetAttestation,
  plan: KubernetesRecoveryPlan,
  current: CurrentKubernetesTarget,
): void {
  const expectedClaimNames = plan.target.volumes.map(({ claimName }) => claimName).sort();
  const expectedVolumeNames = plan.target.volumes.map(({ name }) => name).sort();
  const currentUids = new Set(plan.currentResourceUids);
  const targetUids = [
    target.namespaceUid,
    target.postgresServiceUid,
    ...Object.values(target.claimUids),
    ...Object.values(target.volumeUids),
  ];
  if (
    resolve(target.root) !== resolve(plan.target.volumes[0]!.hostPath, '..') ||
    current.volumes.some(
      ({ hostPath }) => childOrEqual(target.root, hostPath) || childOrEqual(hostPath, target.root),
    ) ||
    Object.keys(target.claimUids).sort().join(',') !== expectedClaimNames.join(',') ||
    Object.keys(target.volumeUids).sort().join(',') !== expectedVolumeNames.join(',') ||
    targetUids.some((uid) => uid.length === 0 || currentUids.has(uid)) ||
    new Set(targetUids).size !== targetUids.length
  ) {
    fail('K8S_LIVE_TARGET_NOT_ISOLATED');
  }
}

function matchingFingerprints(
  source: LiveRecoveryFingerprint,
  restored: LiveRecoveryFingerprint,
): boolean {
  return (
    source.eventHighWaterMark === restored.eventHighWaterMark &&
    source.eventCount === restored.eventCount &&
    source.eventDigest === restored.eventDigest &&
    source.payloadDigest === restored.payloadDigest &&
    source.businessSnapshotHash === restored.businessSnapshotHash &&
    source.authoritativeHash === restored.authoritativeHash &&
    source.identityEvidenceDigest === restored.identityEvidenceDigest &&
    source.runEvidenceDigest === restored.runEvidenceDigest
  );
}

/**
 * Orchestrate one bounded live backup and isolated restore. Every effect is injected so the same
 * fail-closed state machine can drive tests and the host-checkout Kubernetes operator.
 */
export async function executeLiveKubernetesRecoveryDrill(
  dependencies: LiveRecoveryDependencies,
  input: KubernetesDrillInput,
): Promise<Record<string, unknown>> {
  let plan = planKubernetesRecoveryDrill(input);
  const initialCurrent = await dependencies.attestCurrent();
  if (canonicalCurrent(initialCurrent) !== canonicalCurrent(input.current)) {
    fail('K8S_LIVE_CURRENT_TARGET_CHANGED');
  }

  let quiesced = false;
  let backup: CompletedKubernetesBackup;
  let source: LiveRecoveryFingerprint;
  try {
    await dependencies.quiesceCurrent(plan);
    quiesced = true;
    const observed = await dependencies.observeQuiescence();
    try {
      plan = planKubernetesRecoveryDrill({ ...input, quiescence: observed });
    } catch {
      fail('K8S_LIVE_QUIESCENCE_INVALID');
    }
    source = await dependencies.captureSourceFingerprint();
    if (
      !validFingerprint(source) ||
      source.eventHighWaterMark !== plan.quiescenceReceipt.eventHighWaterMark
    ) {
      fail('K8S_LIVE_SOURCE_FINGERPRINT_INVALID');
    }
    try {
      backup = await dependencies.createBackup({ plan, source });
    } catch {
      fail('K8S_LIVE_BACKUP_FAILED');
    }
    validateBackup(backup, plan);
  } finally {
    if (quiesced) {
      try {
        await dependencies.resumeCurrent(plan);
      } catch {
        fail('K8S_LIVE_CURRENT_RESUME_FAILED');
      }
    }
  }

  const target = await dependencies.allocateIsolatedTarget(plan);
  validateTarget(target, plan, initialCurrent);
  let restore: { startedAt: string; readyAt: string; checksumsVerified: true };
  try {
    restore = await dependencies.restoreIsolatedTarget({ plan, backup, target });
  } catch {
    fail('K8S_LIVE_RESTORE_FAILED');
  }
  if (
    restore.checksumsVerified !== true ||
    !validTimestamp(restore.startedAt) ||
    !validTimestamp(restore.readyAt) ||
    new Date(restore.readyAt) < new Date(restore.startedAt)
  ) {
    fail('K8S_LIVE_RESTORE_FAILED');
  }
  try {
    const rebuilt = await dependencies.rebuildIsolatedProjections({ plan, target });
    if (rebuilt.completed !== true) fail('K8S_LIVE_PROJECTION_REBUILD_FAILED');
  } catch (error) {
    if (error instanceof LiveRecoveryError) throw error;
    fail('K8S_LIVE_PROJECTION_REBUILD_FAILED');
  }
  const restored = await dependencies.captureRestoredFingerprint({ plan, target });
  if (!validFingerprint(restored) || !matchingFingerprints(source, restored)) {
    fail('K8S_LIVE_RECOVERY_MISMATCH');
  }
  const finalCurrent = await dependencies.attestCurrent();
  if (canonicalCurrent(finalCurrent) !== canonicalCurrent(initialCurrent)) {
    fail('K8S_LIVE_CURRENT_TARGET_CHANGED');
  }
  const verifiedAt = dependencies.clock();
  if (!validTimestamp(verifiedAt) || new Date(verifiedAt) < new Date(restore.readyAt)) {
    fail('K8S_LIVE_RECOVERY_MISMATCH');
  }

  return {
    ok: true,
    code: 'K8S_LIVE_RECOVERY_COMPLETED',
    evidence: {
      backupId: backup.backupId,
      manifestDigest: backup.manifestDigest,
      artifactCount: liveRecoveryArtifactRefs.length,
      targetNamespace: plan.target.namespace,
      targetNamespaceUid: target.namespaceUid,
      targetPostgresServiceUid: target.postgresServiceUid,
      rpoEvents: source.eventHighWaterMark - restored.eventHighWaterMark,
      rtoMilliseconds: new Date(restore.readyAt).valueOf() - new Date(restore.startedAt).valueOf(),
      authoritativeMatch: source.authoritativeHash === restored.authoritativeHash,
      identityMatch: source.identityEvidenceDigest === restored.identityEvidenceDigest,
      runEvidenceMatch: source.runEvidenceDigest === restored.runEvidenceDigest,
      checksumsVerified: true,
      projectionsRebuilt: true,
      currentTargetPreserved: true,
      startedAt: restore.startedAt,
      readyAt: restore.readyAt,
      verifiedAt,
    },
  };
}
