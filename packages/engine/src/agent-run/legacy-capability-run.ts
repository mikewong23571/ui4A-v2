import type { CapabilityRunEvent } from '../capability-run/run';
import type {
  AgentResultEnvelope,
  AgentRunBirthReferences,
  AgentRunEvent,
  AgentRunJson,
} from './run';

/** Stable identity of the immutable compatibility definition used for T18 replay. */
export const LEGACY_T18_DEFINITION_HASH = 'fnv1a64:aef2b34606a64f5f';

const LEGACY_T18_PROMPT_TEMPLATE_HASH = 'fnv1a64:12d6836ac40d7d92';
const LEGACY_TASK_CONTRACT = {
  ref: 'coding-task@1',
  hash: 'fnv1a64:7eaee4ee964ac368',
} as const;
const LEGACY_RESULT_CONTRACT = {
  ref: 'coding-result@1',
  hash: 'fnv1a64:b673b71c2c904b09',
} as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((child) => canonicalJson(child)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function fingerprint(value: unknown): string {
  const input = canonicalJson(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function reconstructedBirth(
  profileName: string,
  task: Extract<CapabilityRunEvent, { kind: 'capability-run-created' }>['task'],
): AgentRunBirthReferences {
  return {
    schemaVersion: 1,
    kind: 'legacy-t18-reconstructed',
    definition: {
      ref: 'coding-agent@1',
      version: 1,
      sourceHash: LEGACY_T18_DEFINITION_HASH,
      parentHashes: [],
      flattenedHash: LEGACY_T18_DEFINITION_HASH,
    },
    prompt: {
      templateHash: LEGACY_T18_PROMPT_TEMPLATE_HASH,
      compiledHash: fingerprint({
        compiler: 't18-v1',
        goal: task.goal,
        constraints: task.constraints,
        acceptanceCriteria: task.acceptanceCriteria,
        repositoryRef: task.repositoryRef,
        baseRevision: task.baseRevision,
        allowedPaths: task.allowedPaths,
      }),
    },
    runtime: { profileName, profileVersion: 'legacy', adapterVersion: 't18-v1' },
    taskContract: { ...LEGACY_TASK_CONTRACT },
    resultContract: { ...LEGACY_RESULT_CONTRACT },
  };
}

function base(event: CapabilityRunEvent) {
  return {
    eventId: event.eventId,
    commandId: event.commandId,
    runId: event.runId,
    revision: event.revision,
  };
}

function resultEnvelope(
  result: Extract<CapabilityRunEvent, { kind: 'capability-run-succeeded' }>['result'],
): AgentResultEnvelope {
  return {
    schemaVersion: 1,
    contract: { ...LEGACY_RESULT_CONTRACT },
    resultId: result.resultId,
    payload: result as unknown as AgentRunJson,
    artifacts: [
      { ref: 'legacy:patch', ...result.patch },
      { ref: 'legacy:trajectory', ...result.trajectory },
    ],
    evidence: result.testRuns.map((test, index) => ({
      ref: `legacy:test:${index + 1}`,
      kind: 'observed-test',
      detail: test as unknown as AgentRunJson,
    })),
    proposedEffects: [],
  };
}

function decodeOne(event: CapabilityRunEvent): AgentRunEvent {
  if ('schemaVersion' in event && event.schemaVersion !== undefined && event.schemaVersion !== 1) {
    throw new Error(`unsupported T18 capability run schema version ${String(event.schemaVersion)}`);
  }
  switch (event.kind) {
    case 'capability-run-created': {
      const birth = reconstructedBirth(event.profileName, event.task);
      return {
        ...base(event),
        kind: 'agent-run-created',
        principal: event.principal,
        policyScope: event.policyScope,
        source: { ...event.source },
        birth,
        task: {
          schemaVersion: 1,
          contract: { ...LEGACY_TASK_CONTRACT },
          payload: event.task as unknown as AgentRunJson,
        },
      };
    }
    case 'capability-run-preparing':
      return { ...base(event), kind: 'agent-run-preparing' };
    case 'capability-run-started':
      return {
        ...base(event),
        kind: 'agent-run-started',
        handle: {
          ...(event.handle.nativeSessionId === undefined
            ? {}
            : { sessionRef: event.handle.nativeSessionId }),
          detail: { workspace: event.workspace, handle: event.handle } as unknown as AgentRunJson,
        },
      };
    case 'capability-run-cursor-advanced':
      return {
        ...base(event),
        kind: 'agent-run-cursor-advanced',
        priorCursor: event.priorCursor,
        cursor: event.cursor,
        observedSequence: event.normalizedSequence,
      };
    case 'capability-run-restarted':
      return {
        ...base(event),
        kind: 'agent-run-restarted',
        priorCursor: event.priorCursor,
        reason: event.reason,
        ...(event.handle === undefined
          ? {}
          : {
              handle: {
                ...(event.handle.nativeSessionId === undefined
                  ? {}
                  : { sessionRef: event.handle.nativeSessionId }),
                detail: event.handle as unknown as AgentRunJson,
              },
            }),
      };
    case 'capability-run-approval-requested':
      return {
        ...base(event),
        kind: 'agent-run-resource-grant-requested',
        request: {
          requestId: `legacy-grant:${event.runId}:${event.revision}`,
          resource: { kind: 'legacy-resource', ref: event.resource, operations: ['use'] },
          reason: event.reason,
        },
      };
    case 'capability-run-resumed':
      return {
        ...base(event),
        kind: 'agent-run-resource-grant-decided',
        requestId: `legacy-grant:${event.runId}:${event.revision - 1}`,
        decision: {
          outcome: 'granted',
          decidedBy: 'legacy-t18-policy',
          grantRef: `legacy-grant:${event.runId}:${event.revision}`,
        },
      };
    case 'capability-run-succeeded':
      return { ...base(event), kind: 'agent-run-succeeded', result: resultEnvelope(event.result) };
    case 'capability-run-failed':
      return { ...base(event), kind: 'agent-run-failed', code: event.code, reason: event.reason };
    case 'capability-run-cancelled':
      return {
        ...base(event),
        kind: 'agent-run-cancelled',
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      };
    case 'capability-run-staled':
      return { ...base(event), kind: 'agent-run-staled', reason: event.reason };
  }
}

/** Decode immutable T18 events into canonical Agent Run events without mutating source values. */
export function decodeLegacyCapabilityRunEvents(
  events: readonly CapabilityRunEvent[],
): AgentRunEvent[] {
  return events.map(decodeOne);
}
