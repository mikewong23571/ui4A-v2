// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { MetaReceiptProvider, useMetaReceiptFor, useMetaReceiptRecorder } from './meta-receipt';
import { MetaActions } from './common';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const outcomeEntity: SirenEntity = {
  class: ['collection'],
  properties: { count: 8 },
  links: [],
  actions: [],
};

function HostProbe({ rel }: { rel: string }) {
  const receipt = useMetaReceiptFor(rel);
  return <div data-testid={`host-${rel}`}>{receipt ? String(receipt.outcome.properties.count) : 'none'}</div>;
}

function RecorderProbe({ rel }: { rel: string }) {
  const record = useMetaReceiptRecorder(rel);
  return (
    <button type="button" onClick={() => record({ outcome: outcomeEntity })}>
      记录回执
    </button>
  );
}

it('回执由页面级宿主持有:记录后同 rel 可读,他者 rel 不串扰(G02b 稳定宿主)', () => {
  render(
    <MetaReceiptProvider>
      <RecorderProbe rel="meta/application:editorial" />
      <HostProbe rel="meta/application:editorial" />
      <HostProbe rel="meta/application:other" />
    </MetaReceiptProvider>,
  );
  expect(screen.getByTestId('host-meta/application:editorial').textContent).toBe('none');
  fireEvent.click(screen.getByRole('button', { name: '记录回执' }));
  expect(screen.getByTestId('host-meta/application:editorial').textContent).toBe('8');
  expect(screen.getByTestId('host-meta/application:other').textContent).toBe('none');
});

it('无 Provider 时 recorder 为 no-op,不抛错(渲染器可独立使用)', () => {
  render(<RecorderProbe rel="meta/application:editorial" />);
  expect(() => fireEvent.click(screen.getByRole('button', { name: '记录回执' }))).not.toThrow();
});

it('ScopedMetaActions 动作成功 → 回执同时进本地展示与稳定宿主(接线)', async () => {
  // 隔离 ActionRunner 的表单细节,直测 onOutcome 到宿主的接线。
  vi.mock('@/components/action-runner', () => ({
    ActionRunner: (props: {
      onOutcome?: (entity: SirenEntity, result: { ok: boolean; status: number }) => void;
      renderOutcome?: () => null;
    }) => (
      <button
        type="button"
        onClick={() => props.onOutcome?.(outcomeEntity, { ok: true, status: 200 })}
      >
        执行动作
      </button>
    ),
  }));
  const entity: SirenEntity = {
    class: ['meta', 'application'],
    properties: { rel: 'meta/application:editorial' },
    links: [],
    actions: [
      { name: 'deprecate', title: '停用', href: '/_meta/api/exec', method: 'POST', fields: {} },
    ],
  };
  render(
    <MetaReceiptProvider>
      <MetaActions entity={entity} rel="meta/application:editorial" scope="governance" />
      <HostProbe rel="meta/application:editorial" />
    </MetaReceiptProvider>,
  );
  expect(screen.getByTestId('host-meta/application:editorial').textContent).toBe('none');
  fireEvent.click(screen.getByRole('button', { name: '执行动作' }));
  expect(screen.getByTestId('host-meta/application:editorial').textContent).toBe('8');
});
