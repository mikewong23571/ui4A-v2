/** Wire schema version shared by Coding Capability Executor envelopes. */
export const CODING_EXECUTOR_SCHEMA_VERSION = 1 as const;

/** Hard raw-trajectory limits selected by D30; deployments may choose lower task budgets. */
export const CODING_EXECUTION_LIMITS = {
  maxRawChunkBytes: 64 * 1024,
  maxRawBytes: 4 * 1024 * 1024,
  maxRawEvents: 2_000,
} as const;

export type CodingExecutorSchemaVersion = typeof CODING_EXECUTOR_SCHEMA_VERSION;

export interface CodingBudget {
  timeoutSeconds: number;
  maxTurns: number;
  maxCost?: number;
  maxRawEvents: number;
  maxRawBytes: number;
  maxRawChunkBytes: number;
}

export interface CodingRedactionPolicy {
  secretNames: string[];
  redactHostPaths: boolean;
}

/** Provider-neutral task handed to a Coding Executor after server-side authorization. */
export interface CodingTask {
  schemaVersion: CodingExecutorSchemaVersion;
  repositoryRef: string;
  baseRevision: string;
  goal: string;
  constraints: string[];
  acceptanceCriteria: string[];
  allowedPaths: string[];
  budget: CodingBudget;
  redaction: CodingRedactionPolicy;
}

/** UI4A-owned isolated workspace lease. The resolved host path is adapter-private. */
export interface WorkspaceHandle {
  schemaVersion: CodingExecutorSchemaVersion;
  workspaceId: string;
  repositoryRef: string;
  baseRevision: string;
  branch: string;
  leaseId: string;
  allowedPaths: string[];
  mainCheckoutFingerprint: string;
}

/** Durable provider session handle. Provider-private fields are opaque provenance only. */
export interface CodingRunHandle {
  schemaVersion: CodingExecutorSchemaVersion;
  runId: string;
  profileName: string;
  workspaceId: string;
  nativeSessionId?: string;
  cursor?: string;
  providerDetail?: unknown;
}

export interface CodingArtifactRef {
  hash: string;
  sizeBytes: number;
  mediaType: string;
}

export interface CodingTestRun {
  command: string;
  exitCode: number;
  passed: boolean;
  durationMs?: number;
  output?: CodingArtifactRef;
}

interface CodingEventBase {
  schemaVersion: CodingExecutorSchemaVersion;
  eventId: string;
  runId: string;
  sequence: number;
}

export type CodingNormalizedEvent = CodingEventBase &
  (
    | { kind: 'run-started'; nativeSessionId?: string }
    | { kind: 'progress-reported'; message: string; percent?: number }
    | { kind: 'command-started'; commandId: string; summary: string }
    | { kind: 'command-completed'; commandId: string; exitCode: number }
    | { kind: 'files-changed'; files: string[] }
    | { kind: 'tests-completed'; tests: CodingTestRun[] }
    | { kind: 'executor-blocked'; reason: string; requestedResource?: string }
    | { kind: 'restart-boundary'; reason: string; priorCursor?: string }
    | { kind: 'run-completed'; resultId: string }
    | { kind: 'run-failed'; code: string; reason: string }
    | { kind: 'run-cancelled'; reason?: string }
    | { kind: 'provider-event'; providerDetail: unknown }
  );

/** Content-addressed raw event metadata; raw Provider payload stays outside the pure fold. */
export interface CodingRawEvent extends CodingEventBase {
  kind: 'raw-provider-event';
  payload: CodingArtifactRef;
  cursor?: string;
  redacted: boolean;
  truncated: boolean;
  providerDetail?: unknown;
}

export interface CodingResult {
  schemaVersion: CodingExecutorSchemaVersion;
  resultId: string;
  baseRevision: string;
  headRevision: string;
  patch: CodingArtifactRef;
  trajectory: CodingArtifactRef;
  commits: string[];
  changedFiles: string[];
  testRuns: CodingTestRun[];
  summary: string;
  providerDetail?: unknown;
}

/** Probe evidence for one configured server-owned executor profile. */
export interface CodingExecutorDescriptor {
  schemaVersion: CodingExecutorSchemaVersion;
  profileName: string;
  available: boolean;
  taskSchemaVersions: number[];
  features: string[];
  version?: string;
  reason?: string;
}

/** Deployment-owned execution policy. Applications and requests do not construct this value. */
export interface CodingExecutorProfile {
  name: string;
  executorClass: string;
  providerId: string;
  transport: string;
  workspaceBackend: string;
  sandbox: 'read-only' | 'workspace-write';
  timeoutSeconds: number;
  maxTurns?: number;
  envAllowlist: string[];
  networkPolicy: string;
}
