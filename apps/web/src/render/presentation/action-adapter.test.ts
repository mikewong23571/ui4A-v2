import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { createSurfaceActionAdapter } from './action-adapter';

const EMPTY_SCHEMA = { type: 'object', properties: {} };

function actionOf(name: string, fields: Record<string, unknown> = EMPTY_SCHEMA): SirenAction {
  return {
    name,
    title: name,
    method: 'POST',
    href: '/api/exec',
    fields,
  };
}

function entityOf(
  rel: string,
  actions: SirenAction[],
  blocked: Record<string, string> = {},
): SirenEntity {
  return {
    class: ['flow-instance'],
    properties: { rel },
    actions,
    links: [],
    'guard-results': actions.map((action) => ({
      action: action.name,
      blocked: blocked[action.name] !== undefined,
      ...(blocked[action.name] === undefined ? {} : { reason: blocked[action.name] }),
      guards: [],
    })),
  };
}

describe('Surface Action Adapter', () => {
  it('reloads a member, submits the exact rel/action once and returns deduplicated refresh subjects', async () => {
    const current = entityOf('post:first', [actionOf('unpublish')]);
    const fetchEntity = vi.fn().mockResolvedValue(current);
    const exec = vi.fn().mockResolvedValue({ ok: true, entity: current });
    const adapter = createSurfaceActionAdapter({ fetchEntity, exec });

    const result = await adapter.submit({
      subject: 'post:first',
      action: 'unpublish',
      refreshSubjects: ['articles', 'post:first', 'articles'],
    });

    expect(fetchEntity).toHaveBeenCalledTimes(1);
    expect(fetchEntity).toHaveBeenCalledWith('post:first');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith({
      rel: 'post:first',
      action: 'unpublish',
      params: undefined,
    });
    expect(result).toMatchObject({
      outcome: 'executed',
      subject: 'post:first',
      action: 'unpublish',
      refreshSubjects: ['post:first', 'articles'],
    });
  });

  it('refuses a deleted entity or action with zero exec calls', async () => {
    const exec = vi.fn();
    const missingEntity = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(null),
      exec,
    });
    const missingAction = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(entityOf('post:first', [])),
      exec,
    });

    await expect(
      missingEntity.submit({ subject: 'post:first', action: 'archive' }),
    ).resolves.toMatchObject({ outcome: 'refused', code: 'entity-missing', stale: true });
    await expect(
      missingAction.submit({ subject: 'post:first', action: 'archive' }),
    ).resolves.toMatchObject({ outcome: 'refused', code: 'action-undeclared', stale: true });
    expect(exec).not.toHaveBeenCalled();
  });

  it('refuses the current blocked guard before exec and preserves its reason', async () => {
    const exec = vi.fn();
    const adapter = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(
        entityOf('post:first', [actionOf('unpublish')], {
          unpublish: 'guard 不满足: is-published=false',
        }),
      ),
      exec,
    });

    await expect(
      adapter.submit({ subject: 'post:first', action: 'unpublish' }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      code: 'guard-blocked',
      stale: false,
      reason: 'guard 不满足: is-published=false',
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('lets the human renderer satisfy an actor-is-human-only block (T33 surface seam)', async () => {
    const entity: SirenEntity = {
      ...entityOf('confirmation:c1', [actionOf('approve')]),
      'guard-results': [
        {
          action: 'approve',
          blocked: true,
          reason: 'guard 不满足: actor-is-human=false',
          guards: [{ name: 'actor-is-human', pass: false }],
        },
      ],
    };
    const fetchEntity = vi.fn().mockResolvedValue(entity);
    const exec = vi.fn().mockResolvedValue({ ok: true, entity });
    const adapter = createSurfaceActionAdapter({ fetchEntity, exec });

    // renderer 恒为 human:blockedForRenderer 口径下 actor-is-human 不拦截
    // (与 ActionGroup 同规;状态类 guard 失败仍拒绝)。
    const result = await adapter.submit({ subject: 'confirmation:c1', action: 'approve' });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'executed', subject: 'confirmation:c1' });

    const stateBlocked: SirenEntity = {
      ...entity,
      'guard-results': [
        {
          action: 'approve',
          blocked: true,
          reason: 'guard 不满足: is-published=false',
          guards: [
            { name: 'actor-is-human', pass: false },
            { name: 'is-published', pass: false },
          ],
        },
      ],
    };
    const stateAdapter = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(stateBlocked),
      exec,
    });
    const refused = await stateAdapter.submit({ subject: 'confirmation:c1', action: 'approve' });
    expect(refused).toMatchObject({
      outcome: 'refused',
      code: 'guard-blocked',
      reason: 'guard 不满足: is-published=false',
    });
  });

  it('fails closed when the form schema changed after hydration', async () => {
    const exec = vi.fn();
    const currentSchema = {
      type: 'object',
      properties: { reason: { type: 'string', minLength: 3 } },
      required: ['reason'],
    };
    const adapter = createSurfaceActionAdapter({
      fetchEntity: vi
        .fn()
        .mockResolvedValue(entityOf('post:first', [actionOf('archive', currentSchema)])),
      exec,
    });

    await expect(
      adapter.submit({
        subject: 'post:first',
        action: 'archive',
        expected: {
          actionSchema: {
            required: ['reason'],
            properties: { reason: { type: 'string', minLength: 1 } },
            type: 'object',
          },
        },
      }),
    ).resolves.toMatchObject({ outcome: 'refused', code: 'schema-stale', stale: true });
    expect(exec).not.toHaveBeenCalled();
  });

  it('treats reordered JSON Schema object keys as the same current schema', async () => {
    const current = entityOf('post:first', [
      actionOf('archive', {
        type: 'object',
        properties: { reason: { type: 'string', minLength: 1 } },
        required: ['reason'],
      }),
    ]);
    const exec = vi.fn().mockResolvedValue({ ok: true, entity: current });
    const adapter = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(current),
      exec,
    });

    await expect(
      adapter.submit({
        subject: 'post:first',
        action: 'archive',
        expected: {
          actionSchema: {
            required: ['reason'],
            properties: { reason: { minLength: 1, type: 'string' } },
            type: 'object',
          },
        },
      }),
    ).resolves.toMatchObject({ outcome: 'executed' });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('validates an optional entity dependency version immediately before exec', async () => {
    const current = entityOf('post:first', [actionOf('unpublish')]);
    const exec = vi.fn().mockResolvedValue({ ok: true, entity: current });
    const resolveDependencyVersion = vi.fn().mockResolvedValue('entity-v2');
    const adapter = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(current),
      exec,
      resolveDependencyVersion,
    });

    await expect(
      adapter.submit({
        subject: 'post:first',
        action: 'unpublish',
        expected: { dependency: { subject: 'post:first', version: 'entity-v1' } },
      }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      code: 'dependency-stale',
      stale: true,
      expectedVersion: 'entity-v1',
      currentVersion: 'entity-v2',
    });
    expect(resolveDependencyVersion).toHaveBeenCalledWith({
      subject: 'post:first',
      entity: current,
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails closed when a dependency expectation cannot be validated', async () => {
    const exec = vi.fn();
    const adapter = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(entityOf('post:first', [actionOf('unpublish')])),
      exec,
    });

    await expect(
      adapter.submit({
        subject: 'post:first',
        action: 'unpublish',
        expected: { dependency: { subject: 'post:first', version: 'entity-v1' } },
      }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      code: 'dependency-unverifiable',
      stale: true,
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('submits when the optional dependency still matches', async () => {
    const current = entityOf('post:first', [actionOf('unpublish')]);
    const exec = vi.fn().mockResolvedValue({ ok: true, entity: current });
    const adapter = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(current),
      exec,
      resolveDependencyVersion: vi.fn().mockReturnValue('entity-v1'),
    });

    await expect(
      adapter.submit({
        subject: 'post:first',
        action: 'unpublish',
        expected: { dependency: { subject: 'post:first', version: 'entity-v1' } },
      }),
    ).resolves.toMatchObject({ outcome: 'executed' });
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns reload and engine refusals as structured outcomes', async () => {
    const fetchFailure = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockRejectedValue(new Error('offline')),
      exec: vi.fn(),
    });
    await expect(
      fetchFailure.submit({ subject: 'post:first', action: 'unpublish' }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      code: 'reload-failed',
      stale: false,
      reason: 'offline',
    });

    const current = entityOf('post:first', [actionOf('unpublish')]);
    const engineRefusal = createSurfaceActionAdapter({
      fetchEntity: vi.fn().mockResolvedValue(current),
      exec: vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        layer: 'guard',
        reason: 'is-published=false',
      }),
    });
    await expect(
      engineRefusal.submit({ subject: 'post:first', action: 'unpublish' }),
    ).resolves.toMatchObject({
      outcome: 'refused',
      code: 'exec-refused',
      stale: false,
      status: 422,
      layer: 'guard',
      reason: 'is-published=false',
    });
  });

  it('property: arbitrary undeclared member/batch actions never reach exec', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((name) => name.trim() !== '' && name !== 'unpublish'),
        async (undeclared) => {
          const exec = vi.fn();
          const adapter = createSurfaceActionAdapter({
            fetchEntity: vi.fn().mockResolvedValue(entityOf('post:first', [actionOf('unpublish')])),
            exec,
          });
          const result = await adapter.submit({ subject: 'post:first', action: undeclared });
          expect(result).toMatchObject({ outcome: 'refused', code: 'action-undeclared' });
          expect(exec).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('采纳服务端别名实体作为 exec 目标,不再以 subject-mismatch 拒绝(T35 F-17)', async () => {
    // fresh read 按注视 subject(flow:x)发起,服务端 flow 别名以实例 rel(x:main)
    // 返回——服务端是身份权威;适配器应采纳规范 rel 提交 exec。
    const aliased = entityOf('todo-capture:main', [actionOf('add')]);
    const fetchEntity = vi.fn().mockResolvedValue(aliased);
    const exec = vi.fn().mockResolvedValue({ ok: true, entity: aliased });
    const adapter = createSurfaceActionAdapter({ fetchEntity, exec });

    const result = await adapter.submit({ subject: 'flow:todo-capture', action: 'add' });

    expect(result).toMatchObject({ outcome: 'executed', action: 'add' });
    expect(exec).toHaveBeenCalledWith({
      rel: 'todo-capture:main',
      action: 'add',
      params: undefined,
    });
    // 回执携带规范 rel 与原 subject,失效两侧都覆盖。
    expect(result.outcome === 'executed' && result.refreshSubjects).toContain('flow:todo-capture');
    expect(result.outcome === 'executed' && result.refreshSubjects).toContain('todo-capture:main');
  });
});
