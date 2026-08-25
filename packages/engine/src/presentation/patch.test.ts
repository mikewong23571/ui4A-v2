import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { SurfaceCatalog, SurfaceTree } from './surface/index';
import {
  applyRenderPatch,
  createRenderPatchTarget,
  normalizeDirectRenderPatch,
  normalizeRevisionRenderPatch,
  parseRevisionRequest,
  renderPatchesConflict,
} from './patch';

const catalog: SurfaceCatalog = {
  id: 'ui4a',
  version: 'v1',
  words: {
    text: { roles: ['primary-content'], bindings: { content: { sources: ['property'] } } },
    markdown: { roles: ['primary-content'], bindings: { content: { sources: ['property'] } } },
    status: { roles: ['status'], bindings: { value: { sources: ['property'] } } },
  },
};

function dependencies(path: string) {
  return [
    { kind: 'catalog' as const, subject: 'ui4a', version: 'v1' },
    { kind: 'entity' as const, subject: 'post:first', version: 'e1', paths: [path] },
  ];
}

const surface: SurfaceTree = {
  schemaVersion: 1,
  root: {
    kind: 'layout',
    id: 'root',
    role: 'primary-content',
    layout: 'stack',
    dependencies: [],
    provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
    children: [
      {
        kind: 'word',
        id: 'body',
        role: 'primary-content',
        word: 'text',
        bindings: {
          content: { kind: 'property', subject: 'post:first', path: 'properties.fields.body' },
        },
        dependencies: dependencies('properties.fields.body'),
        provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
      },
      {
        kind: 'layout',
        id: 'sidebar',
        role: 'metadata',
        layout: 'stack',
        dependencies: [],
        provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
        children: [
          {
            kind: 'word',
            id: 'state',
            role: 'status',
            word: 'status',
            bindings: {
              value: { kind: 'property', subject: 'post:first', path: 'properties.node' },
            },
            dependencies: dependencies('properties.node'),
            provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
          },
        ],
      },
    ],
  },
};

const revision = {
  sidecarId: 'sidecar:1',
  baseVersion: 3,
  messageId: 'message:9',
  instruction: '正文更突出，动作收起来',
};

describe('thin Revision Request', () => {
  it('accepts exactly sidecar/base/message/instruction and no Presentation payload', () => {
    expect(parseRevisionRequest(revision)).toEqual(revision);
    for (const forbidden of ['surface', 'bindings', 'dependencies', 'catalog', 'sessionId']) {
      expect(() => parseRevisionRequest({ ...revision, [forbidden]: {} })).toThrow(
        /unknown|forbidden/i,
      );
    }
    expect(() => parseRevisionRequest({ ...revision, baseVersion: 0 })).toThrow(/baseVersion/);
  });
});

describe('semantic Render Patch', () => {
  it('normalizes natural-language and direct manipulation to identical semantic operations', () => {
    const operations = [
      { kind: 'density', nodeId: 'body', density: 'spacious' },
      { kind: 'collapse', nodeId: 'sidebar', collapsed: true },
      { kind: 'density', nodeId: 'body', density: 'spacious' },
    ];
    const natural = normalizeRevisionRenderPatch(revision, operations);
    const direct = normalizeDirectRenderPatch({
      sidecarId: revision.sidecarId,
      baseVersion: revision.baseVersion,
      interactionId: 'drag:1',
      operations: [...operations].reverse(),
    });

    expect(natural.operations).toEqual(direct.operations);
    expect(natural.source).toEqual({ kind: 'revision', ref: 'message:9' });
    expect(direct.source).toEqual({ kind: 'direct-manipulation', ref: 'drag:1' });
  });

  it('rejects CSS, code, facts, bindings and arbitrary operation fields', () => {
    for (const operation of [
      { kind: 'density', nodeId: 'body', density: 'compact', className: 'hidden' },
      { kind: 'collapse', nodeId: 'body', collapsed: true, value: 'secret body' },
      { kind: 'compatible-word', nodeId: 'body', word: 'markdown', bindings: {} },
      { kind: 'move', nodeId: 'body', toParentId: 'root', toIndex: 0, code: 'alert(1)' },
      { kind: 'pin', retention: 'pinned', style: { display: 'none' } },
    ]) {
      expect(() => normalizeRevisionRenderPatch(revision, [operation])).toThrow(/unknown/i);
    }
  });

  it('immutably applies all semantic operations, validates the catalog and reports paths', () => {
    const target = createRenderPatchTarget(surface);
    const patch = normalizeRevisionRenderPatch(revision, [
      { kind: 'move', nodeId: 'state', toParentId: 'root', toIndex: 0 },
      { kind: 'collapse', nodeId: 'sidebar', collapsed: true },
      { kind: 'density', nodeId: 'body', density: 'spacious' },
      { kind: 'compatible-word', nodeId: 'body', word: 'markdown' },
      { kind: 'pin', retention: 'pinned' },
    ]);

    const result = applyRenderPatch(target, patch, catalog, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target).not.toBe(target);
    expect(result.target.surface).not.toBe(surface);
    expect(
      surface.root.kind === 'layout' ? surface.root.children.map((child) => child.id) : [],
    ).toEqual(['body', 'sidebar']);
    expect(result.target.surface.root).toMatchObject({
      kind: 'layout',
      children: [{ id: 'state' }, { id: 'body', word: 'markdown' }, { id: 'sidebar' }],
    });
    expect(result.target.collapsedNodeIds).toEqual(['sidebar']);
    expect(result.target.densityByNodeId).toEqual({ body: 'spacious' });
    expect(result.target.retention).toBe('pinned');
    expect(result.changedPaths).toEqual(
      expect.arrayContaining([
        '/surface/nodes/state/parent',
        '/surface/nodes/body/word',
        '/view/collapsed/sidebar',
        '/view/density/body',
        '/retention',
      ]),
    );

    const undo = normalizeDirectRenderPatch({
      sidecarId: 'sidecar:1',
      baseVersion: 4,
      interactionId: 'undo:1',
      operations: result.inverseOperations,
    });
    const undone = applyRenderPatch(result.target, undo, catalog, 4);
    expect(undone).toMatchObject({ ok: true });
    if (undone.ok) expect(undone.target).toEqual(target);
  });

  it('fails atomically for optimistic conflicts, invalid moves and incompatible words', () => {
    const target = createRenderPatchTarget(surface);
    const wordPatch = normalizeRevisionRenderPatch(revision, [
      { kind: 'compatible-word', nodeId: 'body', word: 'status' },
    ]);
    expect(applyRenderPatch(target, wordPatch, catalog, 4)).toMatchObject({
      ok: false,
      code: 'version-conflict',
    });
    expect(applyRenderPatch(target, wordPatch, catalog, 3)).toMatchObject({
      ok: false,
      code: 'catalog-incompatible',
    });

    const cycle = normalizeRevisionRenderPatch(revision, [
      { kind: 'move', nodeId: 'sidebar', toParentId: 'sidebar', toIndex: 0 },
    ]);
    const result = applyRenderPatch(target, cycle, catalog, 3);
    expect(result).toMatchObject({ ok: false, code: 'invalid-operation' });
    expect(target).toEqual(createRenderPatchTarget(surface));
  });

  it('detects overlapping normalized patch paths but allows disjoint semantic edits', () => {
    const collapse = normalizeRevisionRenderPatch(revision, [
      { kind: 'collapse', nodeId: 'sidebar', collapsed: true },
    ]);
    const collapseAgain = normalizeDirectRenderPatch({
      sidecarId: 'sidecar:1',
      baseVersion: 3,
      interactionId: 'collapse:2',
      operations: [{ kind: 'collapse', nodeId: 'sidebar', collapsed: false }],
    });
    const density = normalizeDirectRenderPatch({
      sidecarId: 'sidecar:1',
      baseVersion: 3,
      interactionId: 'density:1',
      operations: [{ kind: 'density', nodeId: 'body', density: 'compact' }],
    });
    expect(renderPatchesConflict(collapse, collapseAgain)).toBe(true);
    expect(renderPatchesConflict(collapse, density)).toBe(false);
  });

  it('property: normalization is deterministic, idempotent and contains no factual payload', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constant('collapse' as const),
            nodeId: fc.string({ minLength: 1 }).filter((value) => value.trim() !== ''),
            collapsed: fc.boolean(),
          }),
          { maxLength: 40 },
        ),
        (operations) => {
          const first = normalizeRevisionRenderPatch(revision, operations);
          const second = normalizeRevisionRenderPatch(revision, first.operations);
          expect(second.operations).toEqual(first.operations);
          expect(JSON.stringify(first)).not.toContain('secret-body-value');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('source governance keeps transport, UI and business payloads outside the kernel', () => {
    const source = readFileSync(new URL('./patch.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/fetch\(|\/api\/exec|React|sessionId|className|pixel|formData/);
  });
});
