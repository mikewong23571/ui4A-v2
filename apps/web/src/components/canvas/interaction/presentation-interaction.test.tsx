// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useContractRefresh } from '../use-contract-refresh';
import { THREAD_UPDATED_EVENT } from '../desk/thread-desk-shared';

const cache = vi.hoisted(() => ({ invalidateAfterExec: vi.fn() }));
vi.mock('../../entity-cache-provider', () => ({ useEntityCache: () => cache }));
afterEach(cleanup);

it('keeps dialogs mounted while invalidating facts and rebuilds once after the last interaction', () => {
  const reload = vi.fn();
  const { result } = renderHook(() => useContractRefresh({ current: reload }));
  let release: () => void;
  act(() => {
    release = result.current();
  });
  act(() => {
    window.dispatchEvent(new CustomEvent(THREAD_UPDATED_EVENT, { detail: 'item:a' }));
  });
  expect(cache.invalidateAfterExec).toHaveBeenCalledWith('item:a');
  expect(reload).not.toHaveBeenCalled();
  act(() => {
    release!();
  });
  expect(reload).toHaveBeenCalledTimes(1);
});
