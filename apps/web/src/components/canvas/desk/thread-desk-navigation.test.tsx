// @vitest-environment jsdom
/**
 * T56 P2.1 Red:书桌条目导航方式与 URL 参数保留(S3 探针 §2 存续矩阵根因;
 * design §4「thread-desk.tsx:290 裸 <a> 改 Next Link」/FR1·FR7/US07)。
 *
 * - Red:工作集条目当前是裸 <a href>(thread-desk.tsx:290),点击即整页硬导航,
 *   FloatingChat 面板塌回 FAB、未发送草稿与在途回合全丢(S3 实测 FAIL 项)。
 *   契约:条目经 Next 客户端路由导航渲染(本文件以 data-client-nav 标记桩
 *   next/link,断言导航机制而非 class 细节),P2.2 改 Link 后转绿。
 * - PASS 钉住:条目 href 保留 thread 与 scope 参数(US07:线与 scope 正确保留;
 *   P2.2 重构材料入口时不得丢失)。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { ThreadDesk } from './thread-desk';
import { EntityCacheProvider } from '../../entity-cache-provider';

// 客户端路由导航标记桩:Next Link 渲染为锚点,本桩额外携带 data-client-nav,
// 供断言「条目走客户端导航」而非裸 <a> 硬导航(S3 存续矩阵 FAIL 根因);
// 透传其余 props(data-nav 合同导航标注必须留在锚点上,I3)。
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} data-client-nav="true" {...rest}>
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
      context: ['todo:t35'],
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
        properties: { rel: 'todo:t35', identity: '完成 T35 全轨道验收', status: 'archived' },
        actions: [],
        links: [{ rel: ['self'], href: '/api/entity?rel=todo:t35' }],
      },
    ],
  };
}

function renderDesk(scope?: string) {
  return render(
    <EntityCacheProvider
      scope={scope}
      fetcher={async (rel) => (rel === 'thread:t1' ? threadEntity() : null)}
      versionFetcher={async () => 'v-test'}
    >
      <ThreadDesk threadId="t1" scope={scope} />
    </EntityCacheProvider>,
  );
}

async function deskEntryLink(scope?: string): Promise<HTMLAnchorElement> {
  const { container } = renderDesk(scope);
  await screen.findByText('完成 T35 全轨道验收');
  const entry = await waitFor(() => {
    const anchor = container.querySelector<HTMLAnchorElement>(
      'a[data-nav="local:desk-entry:todo:t35"]',
    );
    expect(anchor).not.toBeNull();
    return anchor!;
  });
  return entry;
}

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

describe('书桌条目导航(T56 P2.1 Red;S3 §2/design §4/FR7/US07)', () => {
  it('工作集条目经客户端路由导航渲染,而非裸 <a> 硬导航(Red:现状丢草稿根因)', async () => {
    const entry = await deskEntryLink();
    expect(entry.getAttribute('data-client-nav')).toBe('true');
  });

  it('条目 href 保留 thread 与 scope 参数(US07:URL 参数不丢;现状即绿,钉住)', async () => {
    const entry = await deskEntryLink('publishing');
    expect(entry.getAttribute('href')).toContain('thread=t1');
    expect(entry.getAttribute('href')).toContain('scope=publishing');
    expect(entry.getAttribute('href')).toContain(`focus=${encodeURIComponent('todo:t35')}`);
  });
});
