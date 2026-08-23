import type { CodingResult, CodingRunHandle, CodingTask, WorkspaceHandle } from '@ui4a/shared';

export type CapabilityRunStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'waiting-approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'stale';

export interface CapabilityRunSource {
  rel: string;
  action: string;
  eventId: string;
  onDoneAction?: string;
  onErrorAction?: string;
}

export interface CapabilityRun {
  runId: string;
  revision: number;
  status: CapabilityRunStatus;
  principal: string;
  policyScope: string;
  source: CapabilityRunSource;
  profileName: string;
  task: CodingTask;
  workspace?: WorkspaceHandle;
  handle?: CodingRunHandle;
  cursor: string | null;
  normalizedSequence: number;
  restartCount: number;
  result?: CodingResult;
  failure?: { code: string; reason: string };
  terminalReason?: string;
  approvalRequest?: { resource: string; reason: string };
}

export interface CapabilityRunSnapshot {
  runs: Record<string, CapabilityRun>;
  processedEventIds: Record<string, string>;
  commandEventIds: Record<string, string>;
}

interface CommandBase {
  commandId: string;
  eventId: string;
  runId: string;
}

interface RevisionCommandBase extends CommandBase {
  expectedRevision: number;
}

export type CapabilityRunCommand =
  | (CommandBase & {
      kind: 'create';
      task: CodingTask;
      principal: string;
      policyScope: string;
      source: CapabilityRunSource;
      profileName: string;
    })
  | (RevisionCommandBase & { kind: 'prepare' })
  | (RevisionCommandBase & {
      kind: 'start';
      workspace: WorkspaceHandle;
      handle: CodingRunHandle;
    })
  | (RevisionCommandBase & {
      kind: 'advance-cursor';
      expectedCursor: string | null;
      cursor: string;
      normalizedSequence: number;
    })
  | (RevisionCommandBase & {
      kind: 'restart';
      expectedCursor: string | null;
      reason: string;
      handle?: CodingRunHandle;
    })
  | (RevisionCommandBase & {
      kind: 'request-approval';
      resource: string;
      reason: string;
    })
  | (RevisionCommandBase & { kind: 'resume-after-approval' })
  | (RevisionCommandBase & { kind: 'succeed'; result: CodingResult })
  | (RevisionCommandBase & { kind: 'fail'; code: string; reason: string })
  | (RevisionCommandBase & { kind: 'cancel'; reason?: string })
  | (RevisionCommandBase & { kind: 'mark-stale'; reason: string });

interface EventBase {
  eventId: string;
  commandId: string;
  runId: string;
  revision: number;
}

export type CapabilityRunEvent =
  | (EventBase & {
      kind: 'capability-run-created';
      task: CodingTask;
      principal: string;
      policyScope: string;
      source: CapabilityRunSource;
      profileName: string;
    })
  | (EventBase & { kind: 'capability-run-preparing' })
  | (EventBase & {
      kind: 'capability-run-started';
      workspace: WorkspaceHandle;
      handle: CodingRunHandle;
    })
  | (EventBase & {
      kind: 'capability-run-cursor-advanced';
      priorCursor: string | null;
      cursor: string;
      normalizedSequence: number;
    })
  | (EventBase & {
      kind: 'capability-run-restarted';
      priorCursor: string | null;
      reason: string;
      handle?: CodingRunHandle;
    })
  | (EventBase & {
      kind: 'capability-run-approval-requested';
      resource: string;
      reason: string;
    })
  | (EventBase & { kind: 'capability-run-resumed' })
  | (EventBase & { kind: 'capability-run-succeeded'; result: CodingResult })
  | (EventBase & { kind: 'capability-run-failed'; code: string; reason: string })
  | (EventBase & { kind: 'capability-run-cancelled'; reason?: string })
  | (EventBase & { kind: 'capability-run-staled'; reason: string });

export interface CapabilityRunCommandResult {
  snapshot: CapabilityRunSnapshot;
  events: CapabilityRunEvent[];
}

const TERMINAL = new Set<CapabilityRunStatus>(['succeeded', 'failed', 'cancelled', 'stale']);

/** Create an empty, independently replayable Capability Run projection. */
export function createCapabilityRunSnapshot(): CapabilityRunSnapshot {
  return { runs: {}, processedEventIds: {}, commandEventIds: {} };
}

function requireStatus(run: CapabilityRun, statuses: CapabilityRunStatus[], kind: string): void {
  if (!statuses.includes(run.status)) {
    throw new Error(`${kind} is invalid while capability run is ${run.status}`);
  }
}

function assertRevision(run: CapabilityRun, expectedRevision: number): void {
  if (run.revision !== expectedRevision) {
    throw new Error(
      `capability run revision conflict: expected ${expectedRevision}, current ${run.revision}`,
    );
  }
}

function foldOne(
  snapshot: CapabilityRunSnapshot,
  event: CapabilityRunEvent,
): CapabilityRunSnapshot {
  const eventCommand = snapshot.processedEventIds[event.eventId];
  if (eventCommand !== undefined) {
    if (eventCommand !== event.commandId) throw new Error(`eventId ${event.eventId} collision`);
    return snapshot;
  }
  const commandEvent = snapshot.commandEventIds[event.commandId];
  if (commandEvent !== undefined) {
    if (commandEvent !== event.eventId) throw new Error(`commandId ${event.commandId} collision`);
    return snapshot;
  }

  const existing = snapshot.runs[event.runId];
  let run: CapabilityRun;
  if (event.kind === 'capability-run-created') {
    if (existing !== undefined) throw new Error(`capability run ${event.runId} already exists`);
    if (event.revision !== 1) throw new Error('created capability run revision must be 1');
    run = {
      runId: event.runId,
      revision: 1,
      status: 'queued',
      principal: event.principal,
      policyScope: event.policyScope,
      source: { ...event.source },
      profileName: event.profileName,
      task: event.task,
      cursor: null,
      normalizedSequence: 0,
      restartCount: 0,
    };
  } else {
    if (existing === undefined) throw new Error(`capability run ${event.runId} does not exist`);
    if (event.revision !== existing.revision + 1) {
      throw new Error(`capability run revision ${event.revision} is not consecutive`);
    }
    if (TERMINAL.has(existing.status)) throw new Error('capability run is terminal');
    switch (event.kind) {
      case 'capability-run-preparing':
        requireStatus(existing, ['queued'], event.kind);
        run = { ...existing, revision: event.revision, status: 'preparing' };
        break;
      case 'capability-run-started':
        requireStatus(existing, ['preparing'], event.kind);
        if (event.workspace.repositoryRef !== existing.task.repositoryRef) {
          throw new Error('workspace repository does not match task');
        }
        if (event.workspace.baseRevision !== existing.task.baseRevision) {
          throw new Error('workspace base does not match task');
        }
        run = {
          ...existing,
          revision: event.revision,
          status: 'running',
          workspace: event.workspace,
          handle: event.handle,
        };
        break;
      case 'capability-run-cursor-advanced':
        requireStatus(existing, ['running'], event.kind);
        if (event.priorCursor !== existing.cursor)
          throw new Error('capability run cursor conflict');
        if (event.normalizedSequence !== existing.normalizedSequence + 1) {
          throw new Error('normalized event sequence is not consecutive');
        }
        run = {
          ...existing,
          revision: event.revision,
          cursor: event.cursor,
          normalizedSequence: event.normalizedSequence,
          ...(existing.handle === undefined
            ? {}
            : { handle: { ...existing.handle, cursor: event.cursor } }),
        };
        break;
      case 'capability-run-restarted':
        requireStatus(existing, ['running'], event.kind);
        if (event.priorCursor !== existing.cursor)
          throw new Error('capability run cursor conflict');
        run = {
          ...existing,
          revision: event.revision,
          restartCount: existing.restartCount + 1,
          ...(event.handle === undefined ? {} : { handle: event.handle }),
        };
        break;
      case 'capability-run-approval-requested':
        requireStatus(existing, ['running'], event.kind);
        run = {
          ...existing,
          revision: event.revision,
          status: 'waiting-approval',
          approvalRequest: { resource: event.resource, reason: event.reason },
        };
        break;
      case 'capability-run-resumed':
        requireStatus(existing, ['waiting-approval'], event.kind);
        run = {
          ...existing,
          revision: event.revision,
          status: 'running',
          approvalRequest: undefined,
        };
        break;
      case 'capability-run-succeeded':
        requireStatus(existing, ['running'], event.kind);
        if (event.result.baseRevision !== existing.task.baseRevision) {
          throw new Error('result base does not match task');
        }
        run = { ...existing, revision: event.revision, status: 'succeeded', result: event.result };
        break;
      case 'capability-run-failed':
        requireStatus(existing, ['queued', 'preparing', 'running', 'waiting-approval'], event.kind);
        run = {
          ...existing,
          revision: event.revision,
          status: 'failed',
          failure: { code: event.code, reason: event.reason },
        };
        break;
      case 'capability-run-cancelled':
        requireStatus(existing, ['queued', 'preparing', 'running', 'waiting-approval'], event.kind);
        run = {
          ...existing,
          revision: event.revision,
          status: 'cancelled',
          terminalReason: event.reason,
        };
        break;
      case 'capability-run-staled':
        requireStatus(existing, ['preparing', 'running', 'waiting-approval'], event.kind);
        run = {
          ...existing,
          revision: event.revision,
          status: 'stale',
          terminalReason: event.reason,
        };
        break;
    }
  }

  return {
    runs: { ...snapshot.runs, [event.runId]: run },
    processedEventIds: { ...snapshot.processedEventIds, [event.eventId]: event.commandId },
    commandEventIds: { ...snapshot.commandEventIds, [event.commandId]: event.eventId },
  };
}

/** Fold full or incremental Capability Run events with collision detection. */
export function foldCapabilityRunEvents(
  events: readonly CapabilityRunEvent[],
  initial: CapabilityRunSnapshot = createCapabilityRunSnapshot(),
): CapabilityRunSnapshot {
  return events.reduce(foldOne, initial);
}

function commandToEvent(command: CapabilityRunCommand): CapabilityRunEvent {
  const revision = command.kind === 'create' ? 1 : command.expectedRevision + 1;
  const base = {
    eventId: command.eventId,
    commandId: command.commandId,
    runId: command.runId,
    revision,
  };
  switch (command.kind) {
    case 'create':
      return {
        ...base,
        kind: 'capability-run-created',
        task: command.task,
        principal: command.principal,
        policyScope: command.policyScope,
        source: command.source,
        profileName: command.profileName,
      };
    case 'prepare':
      return { ...base, kind: 'capability-run-preparing' };
    case 'start':
      return {
        ...base,
        kind: 'capability-run-started',
        workspace: command.workspace,
        handle: command.handle,
      };
    case 'advance-cursor':
      return {
        ...base,
        kind: 'capability-run-cursor-advanced',
        priorCursor: command.expectedCursor,
        cursor: command.cursor,
        normalizedSequence: command.normalizedSequence,
      };
    case 'restart':
      return {
        ...base,
        kind: 'capability-run-restarted',
        priorCursor: command.expectedCursor,
        reason: command.reason,
        ...(command.handle === undefined ? {} : { handle: command.handle }),
      };
    case 'request-approval':
      return {
        ...base,
        kind: 'capability-run-approval-requested',
        resource: command.resource,
        reason: command.reason,
      };
    case 'resume-after-approval':
      return { ...base, kind: 'capability-run-resumed' };
    case 'succeed':
      return { ...base, kind: 'capability-run-succeeded', result: command.result };
    case 'fail':
      return { ...base, kind: 'capability-run-failed', code: command.code, reason: command.reason };
    case 'cancel':
      return {
        ...base,
        kind: 'capability-run-cancelled',
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      };
    case 'mark-stale':
      return { ...base, kind: 'capability-run-staled', reason: command.reason };
  }
}

/** Judge one command, then fold its single event; retries are idempotent by commandId. */
export function applyCapabilityRunCommand(
  snapshot: CapabilityRunSnapshot,
  command: CapabilityRunCommand,
): CapabilityRunCommandResult {
  const commandEvent = snapshot.commandEventIds[command.commandId];
  if (commandEvent !== undefined) return { snapshot, events: [] };
  const eventCommand = snapshot.processedEventIds[command.eventId];
  if (eventCommand !== undefined) throw new Error(`eventId ${command.eventId} collision`);
  if (command.kind === 'create') {
    if (snapshot.runs[command.runId] !== undefined)
      throw new Error('capability run already exists');
  } else {
    const run = snapshot.runs[command.runId];
    if (run === undefined) throw new Error('capability run does not exist');
    assertRevision(run, command.expectedRevision);
  }
  const event = commandToEvent(command);
  return { snapshot: foldOne(snapshot, event), events: [event] };
}
