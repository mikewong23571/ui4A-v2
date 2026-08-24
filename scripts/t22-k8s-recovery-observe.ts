import { isAbsolute } from 'node:path';

export interface KubectlObservationCommand {
  executable: 'kubectl';
  args: string[];
}

export interface KubernetesRecoveryObservationInput {
  namespace: string;
  firstHwmProbe: string;
  secondHwmProbe: string;
}

export interface KubernetesRecoveryObservationDependencies {
  run(command: KubectlObservationCommand): Promise<{ exitCode: number; stdout: string }>;
  clock(): string;
}

export type KubernetesRecoveryObservationErrorCode =
  | 'K8S_RECOVERY_OBSERVATION_INPUT_INVALID'
  | 'K8S_RECOVERY_OBSERVATION_COMMAND_FAILED'
  | 'K8S_RECOVERY_OBSERVATION_INVALID';

export class KubernetesRecoveryObservationError extends Error {
  constructor(readonly code: KubernetesRecoveryObservationErrorCode) {
    super(code);
    this.name = 'KubernetesRecoveryObservationError';
  }
}

type JsonRecord = Record<string, unknown>;

const dnsLabel = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const claimNames = ['backup-data', 'pki-data', 'postgres-data', 'runtime-data'] as const;
const volumeNames = [
  'ui4a-backup-pv',
  'ui4a-pki-pv',
  'ui4a-postgres-pv',
  'ui4a-runtime-pv',
] as const;
const writerNames = ['keycloak', 'temporal', 'web', 'worker'] as const;
const maximumKubectlJsonBytes = 2 * 1024 * 1024;

function fail(code: KubernetesRecoveryObservationErrorCode): never {
  throw new KubernetesRecoveryObservationError(code);
}

function object(value: unknown): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  return value as JsonRecord;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) fail('K8S_RECOVERY_OBSERVATION_INVALID');
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  return value as number;
}

function metadata(value: JsonRecord): {
  name: string;
  uid: string;
  resourceVersion: string;
  raw: JsonRecord;
} {
  const raw = object(value.metadata);
  return {
    name: string(raw.name),
    uid: string(raw.uid),
    resourceVersion: string(raw.resourceVersion),
    raw,
  };
}

function parse(stdout: string): JsonRecord {
  if (stdout.length === 0 || Buffer.byteLength(stdout) > maximumKubectlJsonBytes) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  try {
    return object(JSON.parse(stdout));
  } catch {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
}

function items(value: JsonRecord): JsonRecord[] {
  if (value.kind !== 'List' || !Array.isArray(value.items)) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  return value.items.map(object);
}

function replicas(value: JsonRecord): { desired: number; ready: number } {
  const spec = object(value.spec);
  const status = object(value.status ?? {});
  return {
    desired: nonNegativeInteger(spec.replicas ?? 1),
    ready: nonNegativeInteger(status.readyReplicas ?? 0),
  };
}

function exactNamedResources(values: JsonRecord[], expectedNames: readonly string[]): JsonRecord[] {
  const byName = new Map<string, JsonRecord>();
  for (const value of values) {
    const name = metadata(value).name;
    if (byName.has(name)) fail('K8S_RECOVERY_OBSERVATION_INVALID');
    byName.set(name, value);
  }
  if (byName.size !== expectedNames.length || expectedNames.some((name) => !byName.has(name))) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  return [...expectedNames].map((name) => byName.get(name)!);
}

function nodeName(volume: JsonRecord): string {
  const spec = object(volume.spec);
  const affinity = object(spec.nodeAffinity);
  const required = object(affinity.required);
  if (!Array.isArray(required.nodeSelectorTerms)) fail('K8S_RECOVERY_OBSERVATION_INVALID');
  for (const termValue of required.nodeSelectorTerms) {
    const term = object(termValue);
    if (!Array.isArray(term.matchExpressions)) continue;
    for (const expressionValue of term.matchExpressions) {
      const expression = object(expressionValue);
      if (
        expression.key === 'kubernetes.io/hostname' &&
        expression.operator === 'In' &&
        Array.isArray(expression.values) &&
        expression.values.length === 1
      ) {
        return string(expression.values[0]);
      }
    }
  }
  fail('K8S_RECOVERY_OBSERVATION_INVALID');
}

function activeAgentJobs(value: JsonRecord): number {
  let active = 0;
  for (const job of items(value)) {
    const meta = metadata(job);
    const labels = object(meta.raw.labels);
    if (labels['app.kubernetes.io/name'] !== 'ui4a-agent-runner') {
      fail('K8S_RECOVERY_OBSERVATION_INVALID');
    }
    const status = object(job.status ?? {});
    const conditions = Array.isArray(status.conditions) ? status.conditions.map(object) : [];
    const terminal =
      typeof status.completionTime === 'string' ||
      conditions.some(
        (condition) =>
          (condition.type === 'Complete' || condition.type === 'Failed') &&
          condition.status === 'True',
      );
    const suspended = object(job.spec ?? {}).suspend === true;
    if (!terminal && !suspended) active += 1;
  }
  return active;
}

function hwmProbe(value: JsonRecord, expectedName: string) {
  if (value.kind !== 'ConfigMap' || value.immutable !== true) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  const meta = metadata(value);
  const labels = object(meta.raw.labels);
  const data = object(value.data);
  if (
    meta.name !== expectedName ||
    labels['ui4a.io/recovery-hwm-probe'] !== 'true' ||
    typeof data.eventHighWaterMark !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(data.eventHighWaterMark)
  ) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  const eventHighWaterMark = Number(data.eventHighWaterMark);
  if (!Number.isSafeInteger(eventHighWaterMark)) fail('K8S_RECOVERY_OBSERVATION_INVALID');
  return {
    eventHighWaterMark,
    ref: {
      name: meta.name,
      uid: meta.uid,
      resourceVersion: meta.resourceVersion,
    },
  };
}

function validateInput(input: KubernetesRecoveryObservationInput): void {
  if (
    !dnsLabel.test(input.namespace) ||
    !dnsLabel.test(input.firstHwmProbe) ||
    !dnsLabel.test(input.secondHwmProbe) ||
    !input.firstHwmProbe.startsWith('ui4a-recovery-hwm-') ||
    !input.secondHwmProbe.startsWith('ui4a-recovery-hwm-') ||
    input.firstHwmProbe === input.secondHwmProbe
  ) {
    fail('K8S_RECOVERY_OBSERVATION_INPUT_INVALID');
  }
}

/** Plan only bounded read-only Kubernetes JSON calls. */
export function planKubernetesRecoveryObservation(
  input: KubernetesRecoveryObservationInput,
): KubectlObservationCommand[] {
  validateInput(input);
  const namespaced = (...args: string[]): KubectlObservationCommand => ({
    executable: 'kubectl',
    args: ['--namespace', input.namespace, ...args, '--output=json'],
  });
  const cluster = (...args: string[]): KubectlObservationCommand => ({
    executable: 'kubectl',
    args: [...args, '--output=json'],
  });
  return [
    cluster('get', 'namespace', input.namespace),
    namespaced('get', 'service', 'postgres'),
    namespaced('get', 'pvc', ...claimNames),
    cluster('get', 'pv', ...volumeNames),
    namespaced('get', 'deployments'),
    namespaced('get', 'statefulset', 'postgres'),
    namespaced('get', 'jobs', '--selector=app.kubernetes.io/name=ui4a-agent-runner'),
    namespaced('get', 'configmap', input.firstHwmProbe),
    namespaced('get', 'configmap', input.secondHwmProbe),
  ];
}

/** Capture one Secret-free operator observation from injected kubectl JSON results. */
export async function captureKubernetesRecoveryObservation(
  dependencies: KubernetesRecoveryObservationDependencies,
  input: KubernetesRecoveryObservationInput,
): Promise<Record<string, unknown>> {
  const commands = planKubernetesRecoveryObservation(input);
  const responses: JsonRecord[] = [];
  for (const command of commands) {
    let result: { exitCode: number; stdout: string };
    try {
      result = await dependencies.run(command);
    } catch {
      fail('K8S_RECOVERY_OBSERVATION_COMMAND_FAILED');
    }
    if (result.exitCode !== 0) fail('K8S_RECOVERY_OBSERVATION_COMMAND_FAILED');
    responses.push(parse(result.stdout));
  }

  const [
    namespaceValue,
    serviceValue,
    claimsValue,
    volumesValue,
    deploymentsValue,
    postgresValue,
    jobsValue,
    firstProbeValue,
    secondProbeValue,
  ] = responses as [
    JsonRecord,
    JsonRecord,
    JsonRecord,
    JsonRecord,
    JsonRecord,
    JsonRecord,
    JsonRecord,
    JsonRecord,
    JsonRecord,
  ];
  const namespace = metadata(namespaceValue);
  const service = metadata(serviceValue);
  if (
    namespaceValue.kind !== 'Namespace' ||
    namespace.name !== input.namespace ||
    serviceValue.kind !== 'Service' ||
    service.name !== 'postgres'
  ) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  const serviceSpec = object(serviceValue.spec);
  const clusterIp = string(serviceSpec.clusterIP);
  if (clusterIp === 'None') fail('K8S_RECOVERY_OBSERVATION_INVALID');

  const claims = exactNamedResources(items(claimsValue), claimNames).map((value) => {
    if (value.kind !== 'PersistentVolumeClaim') fail('K8S_RECOVERY_OBSERVATION_INVALID');
    const meta = metadata(value);
    return { name: meta.name, uid: meta.uid, volumeName: string(object(value.spec).volumeName) };
  });
  const volumes = exactNamedResources(items(volumesValue), volumeNames).map((value) => {
    if (value.kind !== 'PersistentVolume') fail('K8S_RECOVERY_OBSERVATION_INVALID');
    const meta = metadata(value);
    const path = string(object(object(value.spec).local).path);
    if (!isAbsolute(path)) fail('K8S_RECOVERY_OBSERVATION_INVALID');
    return { name: meta.name, uid: meta.uid, hostPath: path, nodeName: nodeName(value) };
  });

  const deploymentItems = items(deploymentsValue);
  const writers = exactNamedResources(
    deploymentItems.filter((value) => writerNames.includes(metadata(value).name as never)),
    writerNames,
  );
  const workloads = Object.fromEntries(
    writers.map((value) => [metadata(value).name, replicas(value)]),
  );
  const runnerDeployment = deploymentItems.find((value) => metadata(value).name === 'runner');
  const postgres = replicas(postgresValue);
  if (postgresValue.kind !== 'StatefulSet' || metadata(postgresValue).name !== 'postgres') {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }

  const first = hwmProbe(firstProbeValue, input.firstHwmProbe);
  const second = hwmProbe(secondProbeValue, input.secondHwmProbe);
  if (
    first.ref.uid === second.ref.uid ||
    first.ref.resourceVersion === second.ref.resourceVersion
  ) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }
  const observedAt = dependencies.clock();
  const observed = new Date(observedAt);
  if (!Number.isFinite(observed.valueOf()) || observed.toISOString() !== observedAt) {
    fail('K8S_RECOVERY_OBSERVATION_INVALID');
  }

  return {
    current: {
      namespace: { name: namespace.name, uid: namespace.uid },
      postgresService: {
        name: service.name,
        uid: service.uid,
        clusterIp,
      },
      claims,
      volumes,
    },
    quiescence: {
      observedAt,
      workloads,
      runner: {
        daemonReplicas: runnerDeployment === undefined ? 0 : replicas(runnerDeployment).desired,
        activeRunJobs: activeAgentJobs(jobsValue),
      },
      postgres,
      eventHighWaterMarks: [first.eventHighWaterMark, second.eventHighWaterMark],
      eventHighWaterMarkProbes: [first.ref, second.ref],
    },
  };
}
