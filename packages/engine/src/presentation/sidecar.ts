import type { RenderSubject } from '@ui4a/shared';

import type { SurfaceProvenance, SurfaceTree } from './surface/index';

export interface UserSidecarKey {
  principal: string;
  policyScope: string;
  subject: RenderSubject;
  intent: string;
  deviceClass: 'any' | 'compact' | 'wide';
}

export interface SidecarDependency {
  id: string;
  subtreeId: string;
  kind: 'entity-contract' | 'collection-membership' | 'definition' | 'catalog' | 'policy';
  ref: string;
  pointers: string[];
  mode: 'rehydrate' | 'invalidate';
  fingerprint: string;
  optional: boolean;
}

export interface SidecarVersionInput {
  surface: SurfaceTree;
  view?: {
    collapsedNodeIds: string[];
    densityByNodeId: Record<string, 'compact' | 'comfortable' | 'spacious'>;
  };
  dependencies: SidecarDependency[];
  provenance: SurfaceProvenance;
  changedPaths: string[];
  recipeRef?: { id: string; version: number };
}

export interface SidecarVersion extends SidecarVersionInput {
  version: number;
  basedOnVersion: number | null;
  retention: 'cache' | 'pinned';
}

export interface UserSidecarAggregate {
  id: string;
  key: UserSidecarKey;
  versions: Record<number, SidecarVersion>;
  activeVersion: number;
  maxVersion: number;
  stale?: { dependencyIds: string[]; reason: string };
}

export interface PresentationSnapshot {
  sidecars: Record<string, UserSidecarAggregate>;
  sidecarIdsByKey: Record<string, string[]>;
  processedEventIds: Record<string, true>;
  commandEventIds: Record<string, string>;
}

interface SidecarEventBase {
  eventId: string;
  commandId: string;
  sidecarId: string;
}

export type PresentationSidecarEvent =
  | (SidecarEventBase & {
      kind: 'user-sidecar-instantiated';
      key: UserSidecarKey;
      version: SidecarVersionInput;
    })
  | (SidecarEventBase & {
      kind: 'user-sidecar-revised';
      baseVersion: number;
      version: SidecarVersionInput;
    })
  | (SidecarEventBase & { kind: 'user-sidecar-pinned'; baseVersion: number })
  | (SidecarEventBase & {
      kind: 'user-sidecar-staled';
      activeVersion: number;
      dependencyIds: string[];
      reason: string;
    })
  | (SidecarEventBase & {
      kind: 'user-sidecar-reverted';
      activeVersion: number;
      targetVersion: number;
    })
  | (SidecarEventBase & { kind: 'user-sidecar-evicted'; activeVersion: number });

export type SidecarCommand =
  | {
      kind: 'instantiate';
      eventId: string;
      commandId: string;
      sidecarId: string;
      key: UserSidecarKey;
      version: SidecarVersionInput;
    }
  | {
      kind: 'revise';
      eventId: string;
      commandId: string;
      sidecarId: string;
      baseVersion: number;
      version: SidecarVersionInput;
    }
  | {
      kind: 'pin';
      eventId: string;
      commandId: string;
      sidecarId: string;
      baseVersion: number;
    }
  | {
      kind: 'stale';
      eventId: string;
      commandId: string;
      sidecarId: string;
      activeVersion: number;
      dependencyIds: string[];
      reason: string;
    }
  | {
      kind: 'revert';
      eventId: string;
      commandId: string;
      sidecarId: string;
      activeVersion: number;
      targetVersion: number;
    }
  | {
      kind: 'evict';
      eventId: string;
      commandId: string;
      sidecarId: string;
      activeVersion: number;
    };

export interface SidecarCommandResult {
  snapshot: PresentationSnapshot;
  events: PresentationSidecarEvent[];
}

export interface DependencyDecision {
  valid: boolean;
  reused: string[];
  replanned: string[];
  rehydrated: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(canonical(value));
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

export function sidecarKeyFingerprint(key: UserSidecarKey): string {
  return fingerprint(key);
}

export function createPresentationSnapshot(): PresentationSnapshot {
  return {
    sidecars: {},
    sidecarIdsByKey: {},
    processedEventIds: {},
    commandEventIds: {},
  };
}

function pathConflict(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function interveningPaths(aggregate: UserSidecarAggregate, baseVersion: number): string[] {
  return Object.values(aggregate.versions)
    .filter((version) => version.version > baseVersion)
    .flatMap((version) => version.changedPaths);
}

function cloneInput(input: SidecarVersionInput): SidecarVersionInput {
  return {
    ...input,
    ...(input.view === undefined
      ? {}
      : {
          view: {
            collapsedNodeIds: [...input.view.collapsedNodeIds],
            densityByNodeId: { ...input.view.densityByNodeId },
          },
        }),
    dependencies: input.dependencies.map((dependency) => ({
      ...dependency,
      pointers: [...dependency.pointers],
    })),
    changedPaths: [...input.changedPaths],
    ...(input.recipeRef === undefined ? {} : { recipeRef: { ...input.recipeRef } }),
  };
}

function foldOne(
  snapshot: PresentationSnapshot,
  event: PresentationSidecarEvent,
): PresentationSnapshot {
  if (snapshot.processedEventIds[event.eventId] === true) return snapshot;
  const commandEvent = snapshot.commandEventIds[event.commandId];
  if (commandEvent !== undefined && commandEvent !== event.eventId) return snapshot;
  const sidecars = { ...snapshot.sidecars };
  let aggregate = sidecars[event.sidecarId];

  if (event.kind === 'user-sidecar-instantiated') {
    if (aggregate !== undefined) throw new Error('sidecar already exists');
    const initial: SidecarVersion = {
      ...cloneInput(event.version),
      version: 1,
      basedOnVersion: null,
      retention: 'cache',
    };
    aggregate = {
      id: event.sidecarId,
      key: { ...event.key },
      versions: { 1: initial },
      activeVersion: 1,
      maxVersion: 1,
    };
  } else {
    if (aggregate === undefined) throw new Error('sidecar does not exist');
    if (event.kind === 'user-sidecar-revised') {
      if (event.baseVersion > aggregate.activeVersion || event.baseVersion < 1) {
        throw new Error('sidecar revision baseVersion is invalid');
      }
      if (
        event.baseVersion !== aggregate.activeVersion &&
        event.version.changedPaths.some((path) =>
          interveningPaths(aggregate!, event.baseVersion).some((prior) =>
            pathConflict(path, prior),
          ),
        )
      ) {
        throw new Error('sidecar revision conflict');
      }
      const nextVersion = aggregate.maxVersion + 1;
      const current = aggregate.versions[aggregate.activeVersion]!;
      aggregate = {
        ...aggregate,
        versions: {
          ...aggregate.versions,
          [nextVersion]: {
            ...cloneInput(event.version),
            version: nextVersion,
            basedOnVersion: aggregate.activeVersion,
            retention: current.retention,
          },
        },
        activeVersion: nextVersion,
        maxVersion: nextVersion,
        stale: undefined,
      };
    } else if (event.kind === 'user-sidecar-pinned') {
      if (event.baseVersion !== aggregate.activeVersion) throw new Error('pin conflict');
      const current = aggregate.versions[aggregate.activeVersion]!;
      const nextVersion = aggregate.maxVersion + 1;
      aggregate = {
        ...aggregate,
        versions: {
          ...aggregate.versions,
          [nextVersion]: {
            ...current,
            version: nextVersion,
            basedOnVersion: aggregate.activeVersion,
            retention: 'pinned',
            changedPaths: ['$retention'],
          },
        },
        activeVersion: nextVersion,
        maxVersion: nextVersion,
      };
    } else if (event.kind === 'user-sidecar-staled') {
      if (event.activeVersion !== aggregate.activeVersion) throw new Error('stale conflict');
      aggregate = {
        ...aggregate,
        stale: { dependencyIds: [...event.dependencyIds], reason: event.reason },
      };
    } else if (event.kind === 'user-sidecar-reverted') {
      if (event.activeVersion !== aggregate.activeVersion) throw new Error('revert conflict');
      if (aggregate.versions[event.targetVersion] === undefined) throw new Error('target missing');
      aggregate = { ...aggregate, activeVersion: event.targetVersion, stale: undefined };
    } else if (event.kind === 'user-sidecar-evicted') {
      if (event.activeVersion !== aggregate.activeVersion) throw new Error('evict conflict');
      if (aggregate.versions[aggregate.activeVersion]?.retention === 'pinned') {
        throw new Error('pinned sidecar cannot be evicted');
      }
      aggregate = { ...aggregate, stale: { dependencyIds: [], reason: 'evicted' } };
    }
  }
  sidecars[event.sidecarId] = aggregate;
  const keyHash = sidecarKeyFingerprint(aggregate.key);
  const ids = snapshot.sidecarIdsByKey[keyHash] ?? [];
  return {
    sidecars,
    sidecarIdsByKey: {
      ...snapshot.sidecarIdsByKey,
      [keyHash]: ids.includes(event.sidecarId) ? ids : [...ids, event.sidecarId],
    },
    processedEventIds: { ...snapshot.processedEventIds, [event.eventId]: true },
    commandEventIds: { ...snapshot.commandEventIds, [event.commandId]: event.eventId },
  };
}

export function foldPresentationEvents(
  events: readonly PresentationSidecarEvent[],
  initial: PresentationSnapshot = createPresentationSnapshot(),
): PresentationSnapshot {
  return events.reduce(foldOne, initial);
}

function eventOf(command: SidecarCommand): PresentationSidecarEvent {
  switch (command.kind) {
    case 'instantiate':
      return { ...command, kind: 'user-sidecar-instantiated' };
    case 'revise':
      return { ...command, kind: 'user-sidecar-revised' };
    case 'pin':
      return { ...command, kind: 'user-sidecar-pinned' };
    case 'stale':
      return { ...command, kind: 'user-sidecar-staled' };
    case 'revert':
      return { ...command, kind: 'user-sidecar-reverted' };
    case 'evict':
      return { ...command, kind: 'user-sidecar-evicted' };
  }
}

export function applySidecarCommand(
  snapshot: PresentationSnapshot,
  command: SidecarCommand,
): SidecarCommandResult {
  if (snapshot.commandEventIds[command.commandId] !== undefined) {
    return { snapshot, events: [] };
  }
  const event = eventOf(command);
  return { snapshot: foldPresentationEvents([event], snapshot), events: [event] };
}

export function dependencyDecision(
  expected: readonly SidecarDependency[],
  current: readonly SidecarDependency[],
): DependencyDecision {
  const currentById = new Map(current.map((dependency) => [dependency.id, dependency]));
  const reused: string[] = [];
  const replanned: string[] = [];
  const rehydrated: string[] = [];
  for (const dependency of expected) {
    const actual = currentById.get(dependency.id);
    if (actual === undefined) {
      if (!dependency.optional && !replanned.includes(dependency.subtreeId)) {
        replanned.push(dependency.subtreeId);
      }
      continue;
    }
    if (actual.fingerprint !== dependency.fingerprint) {
      if (dependency.mode === 'rehydrate') {
        if (!rehydrated.includes(dependency.subtreeId)) rehydrated.push(dependency.subtreeId);
        if (!reused.includes(dependency.subtreeId)) reused.push(dependency.subtreeId);
      } else if (!replanned.includes(dependency.subtreeId)) {
        replanned.push(dependency.subtreeId);
      }
    } else if (!reused.includes(dependency.subtreeId)) {
      reused.push(dependency.subtreeId);
    }
  }
  return { valid: replanned.length === 0, reused, replanned, rehydrated };
}
