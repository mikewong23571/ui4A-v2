// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useSidecarActions, type SidecarMeta } from '../use-sidecar-actions';

const meta: SidecarMeta = {
  id: 'sidecar:current',
  version: 4,
  retention: 'cache',
  rootNodeId: 'root-v4',
  view: { collapsedNodeIds: [], densityByNodeId: { 'root-v4': 'comfortable' } },
};
const readableRefusal =
  '本次视图更改未保存：待处理事项必须保持清楚可见。请保留当前视图或选择其他调整。';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['patch', 'pin', 'revert', 'promotion-preview', 'promote', 'explain'] as const)(
  '%s renders the structured coverage refusal without changing view metadata or reloading',
  async (operation) => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: 'presentation-responsibility-stale',
            detail: 'Replan from the current authorized contract',
          },
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const notify = vi.fn();
    const reload = vi.fn();
    const { result } = renderHook(() => useSidecarActions({ notify, reload, scope: 'publishing' }));
    act(() => {
      result.current.setSidecarMeta(meta);
      result.current.setPromotionPending(operation === 'promote');
    });
    const before = result.current.sidecarMeta;
    await act(async () => {
      if (operation === 'patch') await result.current.patchSidecar('collapse');
      else if (operation === 'pin' || operation === 'revert')
        await result.current.mutateSidecar(operation);
      else if (operation === 'explain') await result.current.explainSidecar();
      else await result.current.promoteSidecar(operation === 'promote');
    });
    expect(notify).toHaveBeenCalledExactlyOnceWith(readableRefusal);
    expect(result.current.sidecarMeta).toBe(before);
    expect(result.current.sidecarMeta).toEqual(meta);
    expect(result.current.promotionPending).toBe(operation === 'promote');
    expect(result.current.explanation).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  },
);

it.each([
  ['普通拒绝', '视图调整失败:普通拒绝'],
  [{ code: 'other-refusal', detail: '请重新选择' }, '视图调整失败:请重新选择'],
  [{ unknown: true }, '视图调整失败:HTTP 409（服务器未提供可读错误详情）'],
])('keeps other errors readable: %j', async (error, expected) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error }, { status: 409 })),
  );
  const notify = vi.fn();
  const { result } = renderHook(() => useSidecarActions({ notify, reload: vi.fn() }));
  act(() => result.current.setSidecarMeta(meta));
  await act(async () => result.current.patchSidecar('collapse'));
  expect(notify).toHaveBeenCalledWith(expected);
  expect(result.current.sidecarMeta).toEqual(meta);
});
