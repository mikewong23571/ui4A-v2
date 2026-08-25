import type { RuntimeBackendExecutionPort } from '../backend';

export type Capability = 'coding' | 'writing' | 'authoring';

export interface HostRunnerTask {
  schemaVersion: 1;
  runId: string;
  capability: Capability;
  birth: {
    definitionHash: string;
    promptHash: string;
    runtimeHash: string;
  };
  payload: unknown;
  [key: string]: unknown;
}

export interface RegisteredRunner {
  id: string;
  authenticatedIdentity: string;
  capabilities: Capability[];
  workspaceRoots: string[];
}

export interface HostRunnerProfile {
  id: string;
  runnerId: string;
  capability: Capability;
  workspaceRoot: string;
  timeoutMs: number;
}

export interface HostRunnerRegistry {
  runners: RegisteredRunner[];
  profiles: HostRunnerProfile[];
}

export interface HostRunnerStateStore {
  load(runId: string): unknown;
  save(runId: string, state: unknown): void;
  list(): unknown[];
}

export interface HostRunnerTransport {
  deliver(command: unknown): Promise<void>;
  cancel(command: unknown): Promise<void>;
}

export interface HostRunnerFsFacts {
  resolve(path: string): { kind: 'file' | 'directory' | 'symlink'; realPath: string };
}

export interface HostRunnerBackendDependencies {
  registry: HostRunnerRegistry;
  state: HostRunnerStateStore;
  transport: HostRunnerTransport;
  clock: { nowMs(): number };
  fsFacts: HostRunnerFsFacts;
  heartbeatTtlMs: number;
  runtimeExecution?: RuntimeBackendExecutionPort;
}

export interface HostRunnerResult {
  runId: string;
  status: 'succeeded' | 'failed';
  resultHash: string;
  artifacts: Array<{ path: string; hash: string }>;
}

export type HostRunStatus =
  | 'unavailable'
  | 'leased'
  | 'claimed'
  | 'delivering'
  | 'executing'
  | 'retryable-disconnect'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'timed-out';

export interface HostRunState {
  schemaVersion: 1;
  backend: 'host';
  runId: string;
  profileId: string;
  runnerId: string;
  workspaceRoot: string;
  task: HostRunnerTask;
  leaseId: string;
  leaseUntilMs: number;
  status: HostRunStatus;
  delivered: boolean;
  cancelSent: boolean;
  restartBoundary: boolean;
  fallbackAttempted: false;
  result?: HostRunnerResult;
  resultHash?: string;
}

export interface RunnerPresence {
  leaseUntilMs: number;
}

export type HostRunnerErrorCode =
  | 'HOST_RUNNER_CAPABILITY_ESCALATION'
  | 'HOST_RUNNER_IDENTITY_INVALID'
  | 'HOST_RUNNER_LEASE_EXPIRED'
  | 'HOST_RUNNER_LEASE_INVALID'
  | 'HOST_RUNNER_FILESYSTEM_FACT_INVALID'
  | 'HOST_RUNNER_PATH_INVALID'
  | 'HOST_RUNNER_PROFILE_INVALID'
  | 'HOST_RUNNER_REGISTRY_INVALID'
  | 'HOST_RUNNER_RESULT_CONFLICT'
  | 'HOST_RUNNER_RESULT_INVALID'
  | 'HOST_RUNNER_ROOT_ESCALATION'
  | 'HOST_RUNNER_STATE_CONFLICT'
  | 'HOST_RUNNER_SYMLINK_ESCAPE'
  | 'HOST_RUNNER_TASK_INVALID'
  | 'HOST_RUNNER_TASK_OVERRIDE_FORBIDDEN'
  | 'HOST_RUNNER_TRANSPORT_FAILED'
  | 'HOST_RUNNER_UNAVAILABLE';

export class HostRunnerError extends Error {
  readonly backend = 'host';
  readonly fallbackAttempted = false;

  constructor(
    readonly code: HostRunnerErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = 'HostRunnerError';
  }
}

export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
export const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const FORBIDDEN_TASK_FIELDS = [
  'backend',
  'image',
  'command',
  'cwd',
  'provider',
  'model',
  'env',
] as const;
export const TERMINAL_STATUSES = new Set<HostRunStatus>([
  'succeeded',
  'failed',
  'canceled',
  'timed-out',
]);
