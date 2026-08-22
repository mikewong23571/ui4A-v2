import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { SurfaceTree } from './surface';
import {
  applySidecarCommand,
  createPresentationSnapshot,
  dependencyDecision,
  foldPresentationEvents,
  sidecarKeyFingerprint,
  type SidecarDependency,
  type SidecarVersionInput,
  type UserSidecarKey,
} from './sidecar';

const key: UserSidecarKey = {
  principal: 'user:mike',
  policyScope: 'author:v1',
  subject: 'post:first',
  intent: 'read',
  deviceClass: 'wide',
};

const surface: SurfaceTree = {
  schemaVersion: 1,
  root: {
    kind: 'diagnostic',
    id: 'root',
    role: 'diagnostic',
    code: 'fixture',
    dependencies: [],
    provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
  },
};

const dependencies: SidecarDependency[] = [
  {
    id: 'entity:post:first',
    subtreeId: 'content',
    kind: 'entity-contract',
    ref: 'post:first',
    pointers: ['properties.fields.body'],
    mode: 'invalidate',
    fingerprint: 'entity-v1',
    optional: false,
  },
  {
    id: 'members:articles',
    subtreeId: 'members',
    kind: 'collection-membership',
    ref: 'articles',
    pointers: ['$entities'],
    mode: 'rehydrate',
    fingerprint: 'members-v1',
    optional: false,
  },
];

function version(changedPaths: string[] = []): SidecarVersionInput {
  return {
    surface,
    dependencies,
    provenance: { kind: 'generic-fallback', ref: 'fixture' },
    changedPaths,
  };
}

describe('Presentation Sidecar event fold', () => {
  it('keeps one user-level key across Session-agnostic callers', () => {
    expect(sidecarKeyFingerprint(key)).toBe(sidecarKeyFingerprint({ ...key }));
    const source = readFileSync(new URL('./sidecar.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/sessionId|session_id/);
  });

  it('replays instantiate, pin, revise, stale and revert with immutable versions', () => {
    let state = createPresentationSnapshot();
    const created = applySidecarCommand(state, {
      kind: 'instantiate',
      eventId: 'event:1',
      commandId: 'command:1',
      sidecarId: 'sidecar:1',
      key,
      version: version(),
    });
    state = created.snapshot;
    state = applySidecarCommand(state, {
      kind: 'pin',
      eventId: 'event:2',
      commandId: 'command:2',
      sidecarId: 'sidecar:1',
      baseVersion: 1,
    }).snapshot;
    state = applySidecarCommand(state, {
      kind: 'revise',
      eventId: 'event:3',
      commandId: 'command:3',
      sidecarId: 'sidecar:1',
      baseVersion: 2,
      version: version(['/root/layout']),
    }).snapshot;
    state = applySidecarCommand(state, {
      kind: 'stale',
      eventId: 'event:4',
      commandId: 'command:4',
      sidecarId: 'sidecar:1',
      activeVersion: 3,
      dependencyIds: ['entity:post:first'],
      reason: 'definition-changed',
    }).snapshot;
    state = applySidecarCommand(state, {
      kind: 'revert',
      eventId: 'event:5',
      commandId: 'command:5',
      sidecarId: 'sidecar:1',
      activeVersion: 3,
      targetVersion: 2,
    }).snapshot;

    const aggregate = state.sidecars['sidecar:1']!;
    expect(aggregate.maxVersion).toBe(3);
    expect(Object.keys(aggregate.versions)).toEqual(['1', '2', '3']);
    expect(aggregate.activeVersion).toBe(2);
    expect(aggregate.versions[2]?.retention).toBe('pinned');
    expect(aggregate.stale).toBeUndefined();
    expect(foldPresentationEvents(created.events)).toEqual(created.snapshot);
  });

  it('deduplicates command retries and rejects conflicting optimistic revisions', () => {
    const created = applySidecarCommand(createPresentationSnapshot(), {
      kind: 'instantiate',
      eventId: 'event:1',
      commandId: 'command:1',
      sidecarId: 'sidecar:1',
      key,
      version: version(),
    });
    const revised = applySidecarCommand(created.snapshot, {
      kind: 'revise',
      eventId: 'event:2',
      commandId: 'command:2',
      sidecarId: 'sidecar:1',
      baseVersion: 1,
      version: version(['/root/a']),
    });
    expect(
      applySidecarCommand(revised.snapshot, {
        kind: 'revise',
        eventId: 'event:retry',
        commandId: 'command:2',
        sidecarId: 'sidecar:1',
        baseVersion: 1,
        version: version(['/root/a']),
      }).snapshot,
    ).toBe(revised.snapshot);
    expect(() =>
      applySidecarCommand(revised.snapshot, {
        kind: 'revise',
        eventId: 'event:3',
        commandId: 'command:3',
        sidecarId: 'sidecar:1',
        baseVersion: 1,
        version: version(['/root/a/child']),
      }),
    ).toThrow(/conflict/i);
    expect(() =>
      applySidecarCommand(revised.snapshot, {
        kind: 'revise',
        eventId: 'event:4',
        commandId: 'command:4',
        sidecarId: 'sidecar:1',
        baseVersion: 1,
        version: version(['/root/b']),
      }),
    ).not.toThrow();
  });

  it('rehydrates values/membership and invalidates only incompatible subtrees', () => {
    expect(
      dependencyDecision(dependencies, [
        { ...dependencies[0]!, fingerprint: 'entity-v1' },
        { ...dependencies[1]!, fingerprint: 'members-v2' },
      ]),
    ).toEqual({
      valid: true,
      reused: ['content', 'members'],
      replanned: [],
      rehydrated: ['members'],
    });
    expect(
      dependencyDecision(dependencies, [
        { ...dependencies[0]!, fingerprint: 'entity-v2' },
        { ...dependencies[1]!, fingerprint: 'members-v1' },
      ]),
    ).toEqual({
      valid: false,
      reused: ['members'],
      replanned: ['content'],
      rehydrated: [],
    });
  });
});
