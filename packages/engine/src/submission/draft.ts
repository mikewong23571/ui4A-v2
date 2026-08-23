import type {
  DraftAggregate,
  DraftKind,
  DraftProvenance,
  DraftValidation,
  DraftVersion,
} from '@ui4a/shared';
import { DRAFT_LIMITS } from '@ui4a/shared';

export interface DraftSnapshot {
  drafts: Record<string, DraftAggregate>;
  processedEventIds: Record<string, true>;
  commandEventIds: Record<string, string>;
}

interface EventBase {
  eventId: string;
  commandId: string;
  draftId: string;
}

interface VersionInput {
  payloadHash: string;
  schemaRef: string;
  provenance: DraftProvenance;
  validation: DraftValidation;
}

export type DraftEvent =
  | (EventBase & {
      kind: 'draft-created';
      owner: string;
      policyScope: string;
      draftKind: DraftKind;
      target?: string;
      baseVersion?: string;
      version: VersionInput;
      expiresAt?: string;
    })
  | (EventBase & {
      kind: 'draft-revised';
      baseVersion: number;
      targetBaseVersion?: string;
      version: VersionInput;
    })
  | (EventBase & {
      kind: 'draft-validated';
      activeVersion: number;
      validation: DraftValidation;
    })
  | (EventBase & {
      kind: 'draft-submitted';
      activeVersion: number;
      activation: string;
    })
  | (EventBase & { kind: 'draft-staled'; activeVersion: number; reason: string })
  | (EventBase & { kind: 'draft-abandoned'; activeVersion: number; reason?: string })
  | (EventBase & { kind: 'draft-accepted'; activeVersion: number })
  | (EventBase & { kind: 'draft-rejected'; activeVersion: number; reason: string })
  | (EventBase & { kind: 'draft-expired'; activeVersion: number });

export type DraftCommand =
  | (EventBase & {
      kind: 'create';
      owner: string;
      policyScope: string;
      draftKind: DraftKind;
      target?: string;
      baseVersion?: string;
      payloadHash: string;
      schemaRef: string;
      provenance: DraftProvenance;
      validation: DraftValidation;
      expiresAt?: string;
    })
  | (EventBase & {
      kind: 'revise';
      baseVersion: number;
      targetBaseVersion?: string;
      payloadHash: string;
      schemaRef: string;
      provenance: DraftProvenance;
      validation: DraftValidation;
    })
  | (EventBase & {
      kind: 'validate';
      activeVersion: number;
      validation: DraftValidation;
    })
  | (EventBase & { kind: 'submit'; activeVersion: number; activation: string })
  | (EventBase & { kind: 'stale'; activeVersion: number; reason: string })
  | (EventBase & { kind: 'abandon'; activeVersion: number; reason?: string })
  | (EventBase & { kind: 'accept'; activeVersion: number })
  | (EventBase & { kind: 'reject'; activeVersion: number; reason: string })
  | (EventBase & { kind: 'expire'; activeVersion: number });

export interface DraftCommandResult {
  snapshot: DraftSnapshot;
  events: DraftEvent[];
}

const TERMINAL = new Set(['accepted', 'rejected', 'abandoned', 'expired']);

export function createDraftSnapshot(): DraftSnapshot {
  return { drafts: {}, processedEventIds: {}, commandEventIds: {} };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Deterministic non-cryptographic fingerprint for pure-kernel comparison. Persistence uses SHA-256. */
export function payloadFingerprint(value: unknown): string {
  const input = canonical(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

export function inspectJsonBudget(options: {
  value: unknown;
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
}): { valid: boolean; bytes: number; depth: number; nodes: number; issues: string[] } {
  const maxBytes = options.maxBytes ?? DRAFT_LIMITS.maxPayloadBytes;
  const maxDepth = options.maxDepth ?? DRAFT_LIMITS.maxDepth;
  const maxNodes = options.maxNodes ?? DRAFT_LIMITS.maxNodes;
  const bytes = new TextEncoder().encode(canonical(options.value)).byteLength;
  let depth = 0;
  let nodes = 0;
  const visit = (value: unknown, level: number): void => {
    nodes += 1;
    depth = Math.max(depth, level);
    if (nodes > maxNodes || depth > maxDepth) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, level + 1);
    } else if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) visit(child, level + 1);
    }
  };
  visit(options.value, 0);
  const issues: string[] = [];
  if (bytes > maxBytes) issues.push(`payload exceeds ${maxBytes} bytes`);
  if (depth > maxDepth) issues.push(`payload exceeds depth ${maxDepth}`);
  if (nodes > maxNodes) issues.push(`payload exceeds ${maxNodes} nodes`);
  return { valid: issues.length === 0, bytes, depth, nodes, issues };
}

function cloneValidation(validation: DraftValidation): DraftValidation {
  return {
    ...validation,
    issues: validation.issues.map((issue) => ({ ...issue })),
  };
}

function cloneVersion(
  input: VersionInput,
  version: number,
  basedOnVersion: number | null,
): DraftVersion {
  return {
    version,
    basedOnVersion,
    payloadHash: input.payloadHash,
    schemaRef: input.schemaRef,
    provenance: { ...input.provenance, sources: [...input.provenance.sources] },
    validation: cloneValidation(input.validation),
  };
}

function foldOne(snapshot: DraftSnapshot, event: DraftEvent): DraftSnapshot {
  if (snapshot.processedEventIds[event.eventId] === true) return snapshot;
  const prior = snapshot.commandEventIds[event.commandId];
  if (prior !== undefined && prior !== event.eventId) return snapshot;
  let aggregate = snapshot.drafts[event.draftId];
  if (event.kind === 'draft-created') {
    if (aggregate !== undefined) throw new Error('draft already exists');
    const version = cloneVersion(event.version, 1, null);
    aggregate = {
      id: event.draftId,
      owner: event.owner,
      policyScope: event.policyScope,
      kind: event.draftKind,
      ...(event.target === undefined ? {} : { target: event.target }),
      ...(event.baseVersion === undefined ? {} : { baseVersion: event.baseVersion }),
      status: version.validation.valid ? 'ready' : 'invalid',
      versions: { 1: version },
      activeVersion: 1,
      maxVersion: 1,
      ...(event.expiresAt === undefined ? {} : { expiresAt: event.expiresAt }),
    };
  } else {
    if (aggregate === undefined) throw new Error('draft does not exist');
    if (event.kind === 'draft-revised') {
      if (event.baseVersion !== aggregate.activeVersion) throw new Error('draft revision conflict');
      if (aggregate.maxVersion >= DRAFT_LIMITS.maxVersions) throw new Error('draft version limit');
      const next = aggregate.maxVersion + 1;
      const version = cloneVersion(event.version, next, event.baseVersion);
      aggregate = {
        ...aggregate,
        versions: { ...aggregate.versions, [next]: version },
        activeVersion: next,
        maxVersion: next,
        ...(event.targetBaseVersion === undefined ? {} : { baseVersion: event.targetBaseVersion }),
        status: version.validation.valid ? 'ready' : 'invalid',
        activation: undefined,
        terminalReason: undefined,
      };
    } else {
      if (event.activeVersion !== aggregate.activeVersion)
        throw new Error('draft version conflict');
      if (event.kind === 'draft-validated') {
        const current = aggregate.versions[aggregate.activeVersion]!;
        aggregate = {
          ...aggregate,
          versions: {
            ...aggregate.versions,
            [aggregate.activeVersion]: {
              ...current,
              validation: cloneValidation(event.validation),
            },
          },
          status: event.validation.valid ? 'ready' : 'invalid',
        };
      } else if (event.kind === 'draft-submitted') {
        if (aggregate.status !== 'ready') throw new Error('only ready draft can be submitted');
        aggregate = { ...aggregate, status: 'pending-approval', activation: event.activation };
      } else if (event.kind === 'draft-staled') {
        aggregate = { ...aggregate, status: 'stale', terminalReason: event.reason };
      } else if (event.kind === 'draft-abandoned') {
        aggregate = { ...aggregate, status: 'abandoned', terminalReason: event.reason };
      } else if (event.kind === 'draft-accepted') {
        if (aggregate.status !== 'pending-approval') throw new Error('draft is not pending');
        aggregate = { ...aggregate, status: 'accepted' };
      } else if (event.kind === 'draft-rejected') {
        if (aggregate.status !== 'pending-approval') throw new Error('draft is not pending');
        aggregate = { ...aggregate, status: 'rejected', terminalReason: event.reason };
      } else {
        aggregate = { ...aggregate, status: 'expired' };
      }
    }
  }
  return {
    drafts: { ...snapshot.drafts, [event.draftId]: aggregate },
    processedEventIds: { ...snapshot.processedEventIds, [event.eventId]: true },
    commandEventIds: { ...snapshot.commandEventIds, [event.commandId]: event.eventId },
  };
}

export function foldDraftEvents(
  events: readonly DraftEvent[],
  initial: DraftSnapshot = createDraftSnapshot(),
): DraftSnapshot {
  return events.reduce(foldOne, initial);
}

function commandToEvent(command: DraftCommand): DraftEvent {
  const base = { eventId: command.eventId, commandId: command.commandId, draftId: command.draftId };
  switch (command.kind) {
    case 'create':
      return {
        ...base,
        kind: 'draft-created',
        owner: command.owner,
        policyScope: command.policyScope,
        draftKind: command.draftKind,
        ...(command.target === undefined ? {} : { target: command.target }),
        ...(command.baseVersion === undefined ? {} : { baseVersion: command.baseVersion }),
        version: {
          payloadHash: command.payloadHash,
          schemaRef: command.schemaRef,
          provenance: command.provenance,
          validation: command.validation,
        },
        ...(command.expiresAt === undefined ? {} : { expiresAt: command.expiresAt }),
      };
    case 'revise':
      return {
        ...base,
        kind: 'draft-revised',
        baseVersion: command.baseVersion,
        ...(command.targetBaseVersion === undefined
          ? {}
          : { targetBaseVersion: command.targetBaseVersion }),
        version: {
          payloadHash: command.payloadHash,
          schemaRef: command.schemaRef,
          provenance: command.provenance,
          validation: command.validation,
        },
      };
    case 'validate':
      return {
        ...base,
        kind: 'draft-validated',
        activeVersion: command.activeVersion,
        validation: command.validation,
      };
    case 'submit':
      return {
        ...base,
        kind: 'draft-submitted',
        activeVersion: command.activeVersion,
        activation: command.activation,
      };
    case 'stale':
      return {
        ...base,
        kind: 'draft-staled',
        activeVersion: command.activeVersion,
        reason: command.reason,
      };
    case 'abandon':
      return {
        ...base,
        kind: 'draft-abandoned',
        activeVersion: command.activeVersion,
        ...(command.reason === undefined ? {} : { reason: command.reason }),
      };
    case 'accept':
      return { ...base, kind: 'draft-accepted', activeVersion: command.activeVersion };
    case 'reject':
      return {
        ...base,
        kind: 'draft-rejected',
        activeVersion: command.activeVersion,
        reason: command.reason,
      };
    case 'expire':
      return { ...base, kind: 'draft-expired', activeVersion: command.activeVersion };
  }
}

/** Apply one command with eventId/commandId idempotency and lifecycle/CAS checks. */
export function applyDraftCommand(
  snapshot: DraftSnapshot,
  command: DraftCommand,
): DraftCommandResult {
  const processed = snapshot.commandEventIds[command.commandId];
  if (processed !== undefined) return { snapshot, events: [] };
  const aggregate = snapshot.drafts[command.draftId];
  if (command.kind !== 'create') {
    if (aggregate === undefined) throw new Error('draft does not exist');
    if (TERMINAL.has(aggregate.status)) throw new Error('draft is terminal');
    if (command.kind === 'revise' && aggregate.status === 'pending-approval') {
      throw new Error('pending draft cannot be revised');
    }
  }
  const event = commandToEvent(command);
  return { snapshot: foldOne(snapshot, event), events: [event] };
}
