import { describe, expect, it } from 'vitest';
import {
  executeWithGates,
  fold,
  project,
  validateDefinition,
  applicationBundleIssues,
  type EngineEvent,
  type ExecRequest,
  type FlowDefinition,
} from '@ui4a/engine';
import { fieldValues, seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';
import artifact from '../todo.bundle.json';
import { todoApplicationBundle } from '../bundles';

const flows = Object.fromEntries(todoApplicationBundle.flows.map((flow) => [flow.name, flow]));
const deps = { flows, guards: seedGuardRegistry };
const initial: EngineSnapshot = {
  instances: {
    'todo-capture:main': {
      rel: 'todo-capture:main',
      flow: 'todo-capture',
      node: 'capture',
      fields: {},
    },
  },
  collections: {},
};
function journey() {
  let snapshot = structuredClone(initial);
  const events: EngineEvent[] = [];
  return {
    get snapshot() {
      return snapshot;
    },
    get events() {
      return events;
    },
    exec(rel: string, action: string, params?: Record<string, unknown>) {
      const outcome = executeWithGates(
        { rel, action, params, actor: 'human', principal: 'user:review', channel: 'http' },
        snapshot,
        deps,
      );
      expect(outcome.kind, JSON.stringify(outcome)).toBe('executed');
      if (outcome.kind !== 'executed') throw new Error('Expected declared execution');
      snapshot = outcome.snapshot;
      events.push(...outcome.events);
    },
  };
}

describe('todo declared capture and correction lifecycle', () => {
  it('starts another item with empty declared inputs while retaining the previous output', () => {
    const run = journey();
    run.exec('todo-capture:main', 'add', { title: 'first', note: '第一条备注' });
    run.exec('todo-capture:main', 'another');
    expect(fieldValues(run.snapshot.instances['todo-capture:main']!.fields)).toEqual({
      title: '',
      note: '',
    });
    const capture = project(run.snapshot, 'todo-capture:main', deps)!;
    expect(capture.actions.find((action) => action.name === 'add')!.fields.required).toContain(
      'title',
    );
    run.exec('todo-capture:main', 'add', { title: 'second', note: '第二条备注' });
    expect(fieldValues(run.snapshot.instances['todo:first']!.fields)).toEqual({
      title: 'first',
      note: '第一条备注',
    });
    expect(fieldValues(run.snapshot.instances['todo:second']!.fields)).toEqual({
      title: 'second',
      note: '第二条备注',
    });
  });

  it('edits twice across completion without changing status and preserves edits through reopen, archive and replay', () => {
    const run = journey();
    run.exec('todo-capture:main', 'add', { title: 'review', note: '第一版' });
    run.exec('todo:review', 'edit', { title: '更正标题', note: '第二版' });
    expect(run.snapshot.instances['todo:review']!.node).toBe('open');
    run.exec('todo:review', 'complete');
    run.exec('todo:review', 'edit', { title: '完成后更正', note: '第三版' });
    expect(run.snapshot.instances['todo:review']!.node).toBe('done');
    expect(project(run.snapshot, 'todo:review', deps)?.properties.fields).toEqual({
      title: '完成后更正',
      note: '第三版',
    });
    run.exec('todo:review', 'reopen');
    run.exec('todo:review', 'edit', { title: '保留标题' });
    expect(fieldValues(run.snapshot.instances['todo:review']!.fields).note).toBeUndefined();
    run.exec('todo:review', 'complete');
    run.exec('todo:review', 'archive');
    expect(project(run.snapshot, 'todo:review', deps)?.actions).toEqual([]);
    const wireEvents = JSON.parse(
      JSON.stringify(run.events.map((event, index) => ({ ...event, seq: index + 1 }))),
    );
    expect(fold(wireEvents, deps, initial).instances).toEqual(run.snapshot.instances);
  });

  it('keeps lifecycle actions parameter-free and requires human confirmation for agent archive in either state', () => {
    const run = journey();
    run.exec('todo-capture:main', 'add', { title: 'archive-case' });
    for (const node of ['open', 'done']) {
      const snapshot = {
        ...run.snapshot,
        instances: {
          ...run.snapshot.instances,
          'todo:archive-case': { ...run.snapshot.instances['todo:archive-case']!, node },
        },
      };
      const entity = project(snapshot, 'todo:archive-case', deps)!;
      const lifecycle = entity.actions.find(
        (action) => action.name === (node === 'open' ? 'complete' : 'reopen'),
      )!;
      expect(lifecycle.fields.properties).toEqual({});
      expect(
        entity.actions.find((action) => action.name === 'archive')?.['requires-confirmation'],
      ).toBe('high');
      const result = executeWithGates(
        { rel: 'todo:archive-case', action: 'archive', actor: 'agent', principal: 'user:review' },
        snapshot,
        deps,
      );
      expect(result.kind).toBe('suspended');
      if (result.kind === 'suspended')
        expect(result.snapshot.instances['todo:archive-case']!.node).toBe(node);
    }
  });

  it('rejects an empty corrected title and validates the governed bundle without new effects', () => {
    const run = journey();
    run.exec('todo-capture:main', 'add', { title: 'validation' });
    const request: ExecRequest = {
      rel: 'todo:validation',
      action: 'edit',
      params: { title: '' },
      actor: 'human',
    };
    expect(executeWithGates(request, run.snapshot, deps)).toMatchObject({
      kind: 'rejected',
      layer: 'schema-invalid',
    });
    expect(applicationBundleIssues(artifact)).toEqual([]);
    for (const flow of Object.values(flows)) {
      const checks = validateDefinition(flow, {
        guards: seedGuardRegistry,
        applications: new Set(['todo']),
        capabilities: new Set(),
      });
      expect(checks.filter((check) => !check.pass)).toEqual([]);
    }
  });

  it('activating a new definition does not grant edit to an instance pinned to an earlier contract', () => {
    const current = flows['todo-item']!;
    const earlier: FlowDefinition = {
      ...current,
      nodes: current.nodes.map((node) => ({
        ...node,
        actions: node.actions.filter((action) => action.name !== 'edit'),
      })),
    };
    const snapshot: EngineSnapshot = {
      instances: {
        'todo:pinned': {
          rel: 'todo:pinned',
          flow: 'todo-item',
          bornVersion: 8,
          node: 'open',
          fields: {},
        },
      },
      collections: { todos: ['todo:pinned'] },
    };
    const pinnedDeps = { ...deps, versions: { 'todo-item': { 8: earlier, 9: current } } };
    expect(
      project(snapshot, 'todo:pinned', pinnedDeps)?.actions.some(
        (action) => action.name === 'edit',
      ),
    ).toBe(false);
    expect(
      executeWithGates(
        { rel: 'todo:pinned', action: 'edit', params: { title: '不迁移' } },
        snapshot,
        pinnedDeps,
      ),
    ).toMatchObject({ kind: 'rejected', layer: 'undeclared' });
  });
});

it('only an explicit retirement can stop the capture entry and it leaves existing items intact', () => {
  const run = journey();
  run.exec('todo-capture:main', 'add', { title: 'keep-existing', note: '保留' });
  const recorded = project(run.snapshot, 'todo-capture:main', deps)!;
  expect(recorded.actions.find((action) => action.name === 'another')).toBeTruthy();
  expect(
    recorded.actions.find((action) => action.name === 'retire')?.['requires-confirmation'],
  ).toBe('high');
  const pending = executeWithGates(
    { rel: 'todo-capture:main', action: 'retire', actor: 'agent', principal: 'user:review' },
    run.snapshot,
    deps,
  );
  expect(pending.kind).toBe('suspended');
  expect(run.snapshot.instances['todo-capture:main']!.node).toBe('recorded');
  const previousItem = structuredClone(run.snapshot.instances['todo:keep-existing']);
  run.exec('todo-capture:main', 'retire');
  expect(project(run.snapshot, 'todo-capture:main', deps)?.properties.title).toBe('捕捉入口已停用');
  expect(project(run.snapshot, 'todo-capture:main', deps)?.actions).toEqual([]);
  expect(run.snapshot.instances['todo:keep-existing']).toEqual(previousItem);
});
