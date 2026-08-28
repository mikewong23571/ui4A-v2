import { homedir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';

import { compareRecoveryFingerprints } from '../backup/t22-recovery-fingerprint';

export interface QuiescenceObservation {
  observedAt: string;
  workloads: Record<'web' | 'worker' | 'keycloak' | 'temporal', { desired: number; ready: number }>;
  runner: { daemonReplicas: number; activeRunJobs: number };
  postgres: { desired: number; ready: number };
  eventHighWaterMarks: [number, number];
}

export interface KubernetesResourceIdentity {
  name: string;
  uid: string;
}

export interface CurrentKubernetesTarget {
  namespace: KubernetesResourceIdentity;
  postgresService: KubernetesResourceIdentity & { clusterIp: string };
  claims: Array<KubernetesResourceIdentity & { volumeName: string }>;
  volumes: Array<KubernetesResourceIdentity & { hostPath: string; nodeName: string }>;
}

export interface KubernetesDrillInput {
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

export interface RecoveryFingerprintEvidence {
  eventHighWaterMark: number;
  eventCount: number;
  eventDigest: string;
  payloadDigest: string;
  runEvidenceDigest: string;
  businessSnapshotHash: string;
  authoritativeHash: string;
}

export interface DrillCommand {
  phase: string;
  executable: string;
  args: string[];
}

export interface KubernetesRecoveryPlan {
  mode: 'isolated';
  destructive: false;
  backupId: string;
  drillId: string;
  source: {
    namespace: string;
    backupClaim: 'backup-data';
    backupReadOnly: true;
  };
  target: {
    namespace: string;
    labels: Record<string, string>;
    nodeName: string;
    postgresService: 'postgres-restore';
    postgresServiceFqdn: string;
    volumes: Array<{ name: string; claimName: string; hostPath: string }>;
  };
  quiescenceReceipt: {
    verified: true;
    eventHighWaterMark: number;
    stopped: Record<'web' | 'worker' | 'runner' | 'keycloak' | 'temporal', true>;
  };
  phases: string[];
  commands: DrillCommand[];
  currentResourceUids: string[];
}

export type KubernetesRecoveryErrorCode =
  | 'K8S_BACKUP_ID_INVALID'
  | 'K8S_DRILL_ID_INVALID'
  | 'K8S_GIT_SHA_INVALID'
  | 'K8S_CURRENT_INVENTORY_INVALID'
  | 'K8S_QUIESCENCE_NOT_ATTESTED'
  | 'K8S_EVENT_HWM_UNSTABLE'
  | 'K8S_POSTGRES_NOT_READY'
  | 'K8S_RESTORE_NODE_MISMATCH'
  | 'K8S_RESTORE_TARGET_NOT_ISOLATED'
  | 'K8S_RECOVERY_COMMAND_FAILED'
  | 'K8S_RECOVERY_EVIDENCE_INVALID';

export class KubernetesRecoveryDrillError extends Error {
  constructor(readonly code: KubernetesRecoveryErrorCode) {
    super(code);
    this.name = 'KubernetesRecoveryDrillError';
  }
}

const phases = [
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
] as const;

function fail(code: KubernetesRecoveryErrorCode): never {
  throw new KubernetesRecoveryDrillError(code);
}

function validIdentity(value: KubernetesResourceIdentity): boolean {
  return value.name.length > 0 && value.uid.length > 0;
}

function isChildOrEqual(candidate: string, parent: string): boolean {
  const normalizedCandidate = resolve(candidate);
  const normalizedParent = resolve(parent);
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(`${normalizedParent}${sep}`)
  );
}

function validateCurrentInventory(current: CurrentKubernetesTarget): void {
  const workloadClaimNames = ['postgres-data', 'runtime-data', 'backup-data', 'pki-data'];
  if (
    !validIdentity(current.namespace) ||
    !validIdentity(current.postgresService) ||
    current.postgresService.clusterIp.length === 0 ||
    current.claims.length === 0 ||
    current.volumes.length === 0 ||
    current.claims.some((claim) => !validIdentity(claim) || claim.volumeName.length === 0) ||
    current.volumes.some(
      (volume) =>
        !validIdentity(volume) || !isAbsolute(volume.hostPath) || volume.nodeName.length === 0,
    )
  ) {
    fail('K8S_CURRENT_INVENTORY_INVALID');
  }
  const identities = [
    current.namespace.uid,
    current.postgresService.uid,
    ...current.claims.map(({ uid }) => uid),
    ...current.volumes.map(({ uid }) => uid),
  ];
  if (new Set(identities).size !== identities.length) fail('K8S_CURRENT_INVENTORY_INVALID');
  const claimNames = new Set(current.claims.map(({ name }) => name));
  if (
    claimNames.size !== current.claims.length ||
    !workloadClaimNames.every((name) => claimNames.has(name))
  ) {
    fail('K8S_CURRENT_INVENTORY_INVALID');
  }
}

function attestQuiescence(observation: QuiescenceObservation) {
  const writerNames = ['web', 'worker', 'keycloak', 'temporal'];
  const observed = new Date(observation.observedAt);
  if (!Number.isFinite(observed.valueOf()) || observed.toISOString() !== observation.observedAt) {
    fail('K8S_QUIESCENCE_NOT_ATTESTED');
  }
  if (
    Object.keys(observation.workloads).sort().join(',') !== writerNames.sort().join(',') ||
    Object.values(observation.workloads).some(
      ({ desired, ready }) => desired !== 0 || ready !== 0,
    ) ||
    observation.runner.daemonReplicas !== 0 ||
    observation.runner.activeRunJobs !== 0
  ) {
    fail('K8S_QUIESCENCE_NOT_ATTESTED');
  }
  if (observation.postgres.desired !== 1 || observation.postgres.ready !== 1) {
    fail('K8S_POSTGRES_NOT_READY');
  }
  const [first, second] = observation.eventHighWaterMarks;
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(second) ||
    first < 0 ||
    second < 0 ||
    first !== second
  ) {
    fail('K8S_EVENT_HWM_UNSTABLE');
  }
  return {
    verified: true as const,
    eventHighWaterMark: second,
    stopped: {
      web: true as const,
      worker: true as const,
      runner: true as const,
      keycloak: true as const,
      temporal: true as const,
    },
  };
}

function validateTarget(input: KubernetesDrillInput): string {
  const { current, target } = input;
  if (target.nodeName.length === 0) fail('K8S_RESTORE_NODE_MISMATCH');
  const backupVolume = current.volumes.find(({ name }) => name === 'ui4a-backup-pv');
  if (backupVolume === undefined || backupVolume.nodeName !== target.nodeName) {
    fail('K8S_RESTORE_NODE_MISMATCH');
  }
  if (
    target.namespace.name === current.namespace.name ||
    target.namespace.exists ||
    target.namespace.uid === current.namespace.uid ||
    target.existingResourceNames.length > 0
  ) {
    fail('K8S_RESTORE_TARGET_NOT_ISOLATED');
  }
  const normalizedRoot = resolve(target.root);
  if (
    !isAbsolute(target.root) ||
    normalizedRoot === resolve('/') ||
    normalizedRoot === resolve(homedir()) ||
    current.volumes.some(
      ({ hostPath }) =>
        isChildOrEqual(normalizedRoot, hostPath) || isChildOrEqual(hostPath, normalizedRoot),
    )
  ) {
    fail('K8S_RESTORE_TARGET_NOT_ISOLATED');
  }
  return normalizedRoot;
}

function commandPlan(input: KubernetesDrillInput): DrillCommand[] {
  const sourceNamespace = input.current.namespace.name;
  const targetNamespace = input.target.namespace.name;
  return phases.map((phase): DrillCommand => {
    switch (phase) {
      case 'attest-current-source':
        return {
          phase,
          executable: 'kubectl',
          args: [
            '--namespace',
            sourceNamespace,
            'get',
            'deployments,statefulsets,jobs,pvc,services',
          ],
        };
      case 'quiesce-single-replica-writers':
        return {
          phase,
          executable: 'kubectl',
          args: [
            '--namespace',
            sourceNamespace,
            'scale',
            'deployment/web',
            'deployment/worker',
            'deployment/keycloak',
            'deployment/temporal',
            '--replicas=0',
          ],
        };
      case 'attest-quiescence-and-source-fingerprint':
        return {
          phase,
          executable: 'kubectl',
          args: [
            '--namespace',
            sourceNamespace,
            'get',
            'deployments,jobs,statefulsets',
            '--output=json',
          ],
        };
      case 'create-named-backup':
        return {
          phase,
          executable: 'node',
          args: [
            'scripts/t22/backup/t22-backup-command.ts',
            'backup',
            '--environment',
            'kubernetes',
          ],
        };
      case 'resume-current-source':
        return {
          phase,
          executable: 'kubectl',
          args: [
            '--namespace',
            sourceNamespace,
            'scale',
            'deployment/web',
            'deployment/worker',
            'deployment/keycloak',
            'deployment/temporal',
            '--replicas=1',
          ],
        };
      case 'allocate-isolated-target':
        return {
          phase,
          executable: 'kubectl',
          args: ['create', 'namespace', targetNamespace],
        };
      case 'restore-isolated-databases':
      case 'restore-isolated-private-files':
        return {
          phase,
          executable: 'node',
          args: [
            'scripts/t22/backup/t22-restore-command.ts',
            'restore',
            '--target',
            'isolated',
            '--phase',
            phase,
          ],
        };
      case 'rebuild-isolated-projections':
      case 'capture-restored-fingerprint':
        return {
          phase,
          executable: 'kubectl',
          args: ['--namespace', targetNamespace, 'create', 'job', `${phase}-${input.drillId}`],
        };
      case 'verify-rpo-rto':
        return {
          phase,
          executable: 'node',
          args: [
            'scripts/t22/backup/t22-recovery-fingerprint.ts',
            'compare',
            '--drill-id',
            input.drillId,
          ],
        };
    }
  });
}

/** Validate observed K8s facts and derive a target that cannot alias current state. */
export function planKubernetesRecoveryDrill(input: KubernetesDrillInput): KubernetesRecoveryPlan {
  if (!/^[0-9a-f]{7,40}$/.test(input.gitSha)) fail('K8S_GIT_SHA_INVALID');
  if (
    !/^ui4a-v0\.1\.0-experimental\.1-kubernetes-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}$/.test(
      input.backupId,
    ) ||
    !input.backupId.endsWith(`-${input.gitSha.slice(0, 7)}`)
  ) {
    fail('K8S_BACKUP_ID_INVALID');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(input.drillId)) {
    fail('K8S_DRILL_ID_INVALID');
  }
  validateCurrentInventory(input.current);
  const quiescenceReceipt = attestQuiescence(input.quiescence);
  const root = validateTarget(input);
  const namespace = input.target.namespace.name;
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(namespace)) {
    fail('K8S_RESTORE_TARGET_NOT_ISOLATED');
  }
  const volumePrefix = namespace;
  const volumes = [
    { component: 'postgres', claimName: 'postgres-restore-data' },
    { component: 'runtime', claimName: 'runtime-restore-data' },
    { component: 'pki', claimName: 'pki-restore-data' },
  ].map(({ component, claimName }) => ({
    name: `${volumePrefix}-${component}-pv`,
    claimName,
    hostPath: resolve(root, component),
  }));
  return {
    mode: 'isolated',
    destructive: false,
    backupId: input.backupId,
    drillId: input.drillId,
    source: {
      namespace: input.current.namespace.name,
      backupClaim: 'backup-data',
      backupReadOnly: true,
    },
    target: {
      namespace,
      labels: {
        'app.kubernetes.io/part-of': 'ui4a',
        'ui4a.io/recovery-drill': input.drillId,
      },
      nodeName: input.target.nodeName,
      postgresService: 'postgres-restore',
      postgresServiceFqdn: `postgres-restore.${namespace}.svc.cluster.local`,
      volumes,
    },
    quiescenceReceipt,
    phases: [...phases],
    commands: commandPlan(input),
    currentResourceUids: [
      input.current.namespace.uid,
      input.current.postgresService.uid,
      ...input.current.claims.map(({ uid }) => uid),
      ...input.current.volumes.map(({ uid }) => uid),
    ],
  };
}

/** Execute only an already validated explicit argv plan through an injected runner. */
export async function executeKubernetesRecoveryDrill(
  dependencies: {
    run(command: { executable: string; args: string[] }): Promise<{ exitCode: number }>;
  },
  input: KubernetesDrillInput,
): Promise<{ ok: true; plan: KubernetesRecoveryPlan }> {
  const plan = planKubernetesRecoveryDrill(input);
  for (const command of plan.commands) {
    let result: { exitCode: number };
    try {
      result = await dependencies.run({
        executable: command.executable,
        args: [...command.args],
      });
    } catch {
      fail('K8S_RECOVERY_COMMAND_FAILED');
    }
    if (result.exitCode !== 0) fail('K8S_RECOVERY_COMMAND_FAILED');
  }
  return { ok: true, plan };
}

function validateFingerprint(fingerprint: RecoveryFingerprintEvidence): void {
  if (
    !Number.isSafeInteger(fingerprint.eventHighWaterMark) ||
    fingerprint.eventHighWaterMark < 0 ||
    !Number.isSafeInteger(fingerprint.eventCount) ||
    fingerprint.eventCount < 0 ||
    [
      fingerprint.eventDigest,
      fingerprint.payloadDigest,
      fingerprint.runEvidenceDigest,
      fingerprint.businessSnapshotHash,
      fingerprint.authoritativeHash,
    ].some((digest) => !/^sha256:[0-9a-f]{64}$/.test(digest))
  ) {
    fail('K8S_RECOVERY_EVIDENCE_INVALID');
  }
}

/** Build Secret-free recovery evidence tied to the isolated resource UIDs and measured times. */
export function buildKubernetesRecoveryEvidence(input: {
  plan: KubernetesRecoveryPlan;
  source: RecoveryFingerprintEvidence;
  restored: RecoveryFingerprintEvidence;
  startedAt: string;
  readyAt: string;
  verifiedAt: string;
  targetNamespaceUid: string;
  targetPostgresServiceUid: string;
  targetClaimUids: Record<string, string>;
}): Record<string, unknown> {
  validateFingerprint(input.source);
  validateFingerprint(input.restored);
  const requiredClaims = input.plan.target.volumes.map(({ claimName }) => claimName).sort();
  if (
    input.targetNamespaceUid.length === 0 ||
    input.targetPostgresServiceUid.length === 0 ||
    input.plan.currentResourceUids.includes(input.targetNamespaceUid) ||
    input.plan.currentResourceUids.includes(input.targetPostgresServiceUid) ||
    Object.keys(input.targetClaimUids).sort().join(',') !== requiredClaims.join(',') ||
    Object.values(input.targetClaimUids).some(
      (uid) => uid.length === 0 || input.plan.currentResourceUids.includes(uid),
    ) ||
    new Set([
      input.targetNamespaceUid,
      input.targetPostgresServiceUid,
      ...Object.values(input.targetClaimUids),
    ]).size !==
      2 + requiredClaims.length ||
    input.source.eventHighWaterMark !== input.plan.quiescenceReceipt.eventHighWaterMark
  ) {
    fail('K8S_RECOVERY_EVIDENCE_INVALID');
  }
  let comparison;
  try {
    comparison = compareRecoveryFingerprints({
      source: { schemaVersion: 1, projectionsExcluded: true, ...input.source },
      restored: { schemaVersion: 1, projectionsExcluded: true, ...input.restored },
      restoreStartedAt: input.startedAt,
      readyAt: input.readyAt,
      verifiedAt: input.verifiedAt,
    });
  } catch {
    fail('K8S_RECOVERY_EVIDENCE_INVALID');
  }
  return {
    schemaVersion: 1,
    backupId: input.plan.backupId,
    mode: 'isolated',
    status: comparison.authoritativeMatch ? 'passed' : 'failed',
    sourceEnvironmentId: input.plan.source.namespace,
    targetEnvironmentId: input.plan.target.namespace,
    ...comparison,
    sourceFingerprint: { ...input.source },
    restoredFingerprint: { ...input.restored },
    targetAttestation: {
      namespace: { name: input.plan.target.namespace, uid: input.targetNamespaceUid },
      postgresService: {
        name: input.plan.target.postgresService,
        uid: input.targetPostgresServiceUid,
      },
      claimUids: { ...input.targetClaimUids },
    },
    startedAt: input.startedAt,
    readyAt: input.readyAt,
    verifiedAt: input.verifiedAt,
  };
}
