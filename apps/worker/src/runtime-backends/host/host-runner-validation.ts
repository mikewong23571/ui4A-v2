import {
  FORBIDDEN_TASK_FIELDS,
  HostRunnerError,
  RUN_ID_PATTERN,
  SHA256_PATTERN,
  STABLE_ID_PATTERN,
  type HostRunState,
  type HostRunnerErrorCode,
  type HostRunnerRegistry,
  type HostRunnerTask,
  type RegisteredRunner,
} from './host-runner-types';

export function fail(code: HostRunnerErrorCode, retryable = false): never {
  throw new HostRunnerError(code, retryable);
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(',')}}`;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export function absoluteRoot(value: string): boolean {
  return (
    value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').some((part) => part === '.' || part === '..')
  );
}

export function validateRegistry(registry: HostRunnerRegistry): void {
  const runners = new Map<string, RegisteredRunner>();
  for (const runner of registry.runners) {
    if (
      !STABLE_ID_PATTERN.test(runner.id) ||
      runner.authenticatedIdentity.trim() === '' ||
      runner.capabilities.length === 0 ||
      new Set(runner.capabilities).size !== runner.capabilities.length ||
      runner.workspaceRoots.length === 0 ||
      runner.workspaceRoots.some((root) => !absoluteRoot(root)) ||
      new Set(runner.workspaceRoots).size !== runner.workspaceRoots.length ||
      runners.has(runner.id)
    ) {
      fail('HOST_RUNNER_REGISTRY_INVALID');
    }
    runners.set(runner.id, runner);
  }

  const profileIds = new Set<string>();
  for (const profile of registry.profiles) {
    const runner = runners.get(profile.runnerId);
    if (
      !STABLE_ID_PATTERN.test(profile.id) ||
      profileIds.has(profile.id) ||
      runner === undefined ||
      !runner.capabilities.includes(profile.capability) ||
      !runner.workspaceRoots.includes(profile.workspaceRoot) ||
      !Number.isSafeInteger(profile.timeoutMs) ||
      profile.timeoutMs < 1
    ) {
      fail('HOST_RUNNER_REGISTRY_INVALID');
    }
    profileIds.add(profile.id);
  }
}

export function validateTask(task: HostRunnerTask): void {
  if (FORBIDDEN_TASK_FIELDS.some((field) => Object.hasOwn(task, field))) {
    fail('HOST_RUNNER_TASK_OVERRIDE_FORBIDDEN');
  }
  if (
    task.schemaVersion !== 1 ||
    !RUN_ID_PATTERN.test(task.runId) ||
    (task.capability !== 'coding' &&
      task.capability !== 'writing' &&
      task.capability !== 'authoring') ||
    typeof task.birth !== 'object' ||
    task.birth === null ||
    !SHA256_PATTERN.test(task.birth.definitionHash) ||
    !SHA256_PATTERN.test(task.birth.promptHash) ||
    !SHA256_PATTERN.test(task.birth.runtimeHash)
  ) {
    fail('HOST_RUNNER_TASK_INVALID');
  }
}

export function runState(value: unknown): HostRunState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Partial<HostRunState>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.backend !== 'host' ||
    typeof candidate.runId !== 'string' ||
    typeof candidate.leaseId !== 'string'
  ) {
    return undefined;
  }
  return candidate as HostRunState;
}

export function safeArtifactPath(path: string): boolean {
  const segments = path.split('/');
  return (
    path !== '' &&
    !path.startsWith('/') &&
    !/^[A-Za-z]:/u.test(path) &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

export function containedBy(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}
