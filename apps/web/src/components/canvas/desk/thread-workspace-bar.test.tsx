// @vitest-environment jsdom
/**
 * T56 P2.2:本线壳条契约(D78 决定 1/design §1/FR2·FR4/US01·US07)。
 *
 * - 对象页壳条:「返回本线」href 保留 thread/scope/focus=thread(US07),
 *   线身份与生命周期常显(FR2);本线概览页不重复叙述;
 * - 「相关材料(n)」入口默认收起(D78:默认无永久材料栏、不自动打开材料);
 *   计数 = context 成员卡 + 仅钉住页(与书桌工作集同口径);
 * - 覆盖层:复用 ThreadDesk 目录;Escape/关闭按钮收起且焦点恢复到触发键
 *   (design §1 覆盖层交互下限);条目选中回调主区聚焦并关闭覆盖层;
 * - 线不可读时入口不伪称 0(零发明)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { threadPinsKey } from './thread-desk';
import { ThreadWorkspaceBar } from './thread-workspace-bar';
import { EntityCacheProvider } from '../../entity-cache-provider';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
  }: {
    href: string;
    children?: ReactNode;
    onClick?: () => void;
  }) => (
    <a
      href={href}
      data-client-nav="true"
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

function threadEntity(): SirenEntity {
  return {
    class: ['work-thread', 'open'],
    properties: {
      rel: 'thread:t1',
      id: 't1',
      identity: '处理 CVE 批次',
      goal: { text: '处理 CVE 批次', source: 'chat 消息' },
      status: 'open',
      statusText: '进行中',
      context: ['post:p1'],
      resume: '停在「进行中」',
      active: [],
      approval: [],
      'recent-events': [],
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=thread:t1' }],
    'guard-results': [],
    entities: [
      {
        class: ['thread-reference'],
        properties: { rel: 'post:p1', identity: '第一篇', status: 'published' },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=post:p1' }],
      },
    ],
  };
}

function renderBar(props: {
  onThreadSelf?: boolean;
  scope?: string;
  entities?: Record<string, SirenEntity>;
  onEntryNavigate?: () => void;
}) {
  const rows = props.entities ?? { 'thread:t1': threadEntity() };
  return render(
    <EntityCacheProvider
      scope={props.scope}
      fetcher={async (rel) => rows[rel] ?? null}
      versionFetcher={async () => 'v-test'}
    >
      <ThreadWorkspaceBar
        threadId="t1"
        scope={props.scope}
        onThreadSelf={props.onThreadSelf ?? false}
        onEntryNavigate={props.onEntryNavigate ?? (() => undefined)}
      />
    </EntityCacheProvider>,
  );
}

function materialsEntry(): HTMLButtonElement {
  return screen.getByRole('button', { name: /相关材料/ }) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

describe('ThreadWorkspaceBar(本线壳条)', () => {
  it('对象页:返回本线 href 保留 thread/scope/focus=thread,线身份与生命周期常显', async () => {
    const { container } = renderBar({ scope: 'publishing' });
    const back = await screen.findByRole('link', { name: '返回本线' });
    expect(back.getAttribute('data-client-nav')).toBe('true');
    const href = back.getAttribute('href') ?? '';
    expect(href).toContain('thread=t1');
    expect(href).toContain(`focus=${encodeURIComponent('thread:t1')}`);
    expect(href).toContain('scope=publishing');
    await waitFor(() =>
      expect(screen.getByTestId('thread-bar-identity').textContent).toBe('处理 CVE 批次'),
    );
    expect(screen.getByTestId('thread-bar-status').textContent).toBe('进行中');
    expect(container.textContent).toContain('处理 CVE 批次');
  });

  it('本线概览页不重复叙述身份/状态,仅露材料入口(FR2 避免重复)', () => {
    renderBar({ onThreadSelf: true });
    expect(screen.queryByRole('link', { name: '返回本线' })).toBeNull();
    expect(screen.queryByTestId('thread-bar-identity')).toBeNull();
    expect(screen.getByRole('button', { name: /相关材料/ })).toBeTruthy();
  });

  it('相关材料入口默认收起;计数 = context 成员 + 仅钉住页(D78 不伪称)', async () => {
    globalThis.localStorage?.setItem(threadPinsKey('t1'), JSON.stringify(['post:p2']));
    renderBar({});
    const entry = await waitFor(() => {
      const button = materialsEntry();
      expect(button.getAttribute('aria-expanded')).toBe('false');
      return button;
    });
    // 1 个 context 成员卡 + 1 个仅钉住 rel = 2。
    expect(entry.textContent).toBe('相关材料（2）');
    expect(screen.queryByTestId('thread-materials-dialog')).toBeNull();
  });

  it('展开覆盖层复用书桌目录;Escape 关闭且焦点恢复到触发键(design §1)', async () => {
    renderBar({});
    fireEvent.click(materialsEntry());
    const dialog = await screen.findByTestId('thread-materials-dialog');
    expect(dialog.textContent).toContain('处理 CVE 批次');
    expect(dialog.textContent).toContain('第一篇');
    expect(materialsEntry().getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('thread-materials-dialog')).toBeNull());
    expect(document.activeElement).toBe(materialsEntry());
  });

  it('关闭按钮收起覆盖层并恢复焦点;条目选中回调主区聚焦并关闭覆盖层', async () => {
    const onEntryNavigate = vi.fn();
    renderBar({ onEntryNavigate });
    fireEvent.click(materialsEntry());
    fireEvent.click(await screen.findByRole('button', { name: '关闭' }));
    expect(screen.queryByTestId('thread-materials-dialog')).toBeNull();
    expect(document.activeElement).toBe(materialsEntry());

    fireEvent.click(materialsEntry());
    const entryLink = await screen.findByRole('link', { name: '第一篇' });
    fireEvent.click(entryLink);
    expect(onEntryNavigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('thread-materials-dialog')).toBeNull();
  });

  it('线不可读时入口不伪称 0(零发明)', async () => {
    renderBar({ entities: {} });
    await waitFor(() => expect(materialsEntry().textContent).toBe('相关材料'));
  });
});
