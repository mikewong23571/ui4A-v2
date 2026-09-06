// @vitest-environment jsdom
/**
 * T56 P3.2 Red→Green:知情决定与回执(US02/US04/US10;FR6)。
 *
 * 本线责任卡(approval 成员卡)的 approve/reject 信息契约与提交契约:
 * - A1 完整决定信息:同一主面可读目标对象、动作、依据(复用 T54 知情确认
 *   词汇:confirmation 投影的 target-rel/target-action/policy-reason);
 * - A2 未知前值明确:确认合同无前值/影响声明字段 → 显式「未提供」,
 *   不用当前值假扮批准时依据;
 * - A3 一次提交走原闸门:成员卡动作经 surface submit(提交前 fresh read,
 *   POST /api/exec)走既有 confirmation 裁决入口;
 * - A4 过期/重复提交:已决确认的陈旧动作提交被拦截,诚实失败、零第二事件;
 * - A5 human/agent 权限:UI 提交身份固定 human 渲染信道,无身份改写面
 *   (引擎 guard 拒绝 agent approve 由 service.confirmation 门禁钉住);
 * - A6 决定后回读:成功 → 回执保留可读(已由 human 批准/驳回 + 驳回原因)、
 *   责任卡状态回读更新、动作组从 fresh actions 消失;
 * - A7 归档异常责任:archived 线 + pending 确认 → 责任卡仍可达、动作可用;
 * - A8 Meta 边界:被引目标是 meta/ 定义时,本线责任卡不渲染内联 approve,
 *   显式跨入治理宿主路由(/meta/entity)。
 *
 * 单元面:MemberCardWord 直渲染(读失败诚实回退);集成面:CanvasBody 全
 * 管线(thread 投影成员卡 → generic 规划 member-card → surface submit),
 * mock 口径同 presentation-surface-host.thread-nav.test。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { renderCatalogJson } from '@/render/registry';

import { ActionSubmitProvider, createDirectActionSubmit } from './action-submit';
import { MemberCardWord } from '../../render/words/member-card';
import { CanvasBody } from '../canvas/canvas-body';

vi.mock('next/navigation', () => ({
  usePathname: () => '/canvas',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const THREAD_IDENTITY = '完成一项跨应用评审并记录决定';
const POLICY_REASON = 'requires-confirmation=high 且 actor=agent,需人类确认';

function approveAction(): SirenAction {
  return {
    name: 'approve',
    title: '批准',
    method: 'POST',
    href: '/api/exec',
    'requires-confirmation': 'high',
    fields: { type: 'object', properties: {} },
  };
}

function rejectAction(): SirenAction {
  return {
    name: 'reject',
    title: '驳回',
    method: 'POST',
    href: '/api/exec',
    'requires-confirmation': 'high',
    fields: {
      type: 'object',
      properties: { reason: { type: 'string', title: '原因', minLength: 1 } },
      required: ['reason'],
    },
  };
}

/** 线投影的 approval 角色成员卡(D78 决定 2 形状;pending 携带声明动作组)。 */
function approvalMember(
  rel: string,
  actionText: string,
  status: 'pending' | 'approved' | 'rejected',
): SirenEntity {
  return {
    class: ['thread-reference'],
    properties: {
      rel,
      identity: `${actionText} · 由 agent 提议`,
      status,
      category: 'approval',
      presentation: { version: 1, traits: ['human-responsibility'] },
    },
    actions: status === 'pending' ? [approveAction(), rejectAction()] : [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` }],
  };
}

/** 确认实体投影(T54 知情确认词汇;contract/siren/project.ts 同形)。 */
function confirmationEntity(
  rel: string,
  targetRel: string,
  status: 'pending' | 'approved' | 'rejected',
): SirenEntity {
  const actionText = targetRel.startsWith('meta/') ? 'deprecate' : 'archive';
  const decided = status !== 'pending';
  return {
    class: ['confirmation', status],
    properties: {
      id: rel.slice('confirmation:'.length),
      rel,
      'target-rel': targetRel,
      'target-action': actionText,
      params: { reason: '代理请求需要人工复核' },
      identity: decided
        ? `${actionText} · 已由 human ${status === 'approved' ? '批准' : '驳回'}`
        : `${actionText}〔需high确认〕 · 由 agent 提议`,
      resume: `对象 ${targetRel} · reason=代理请求需要人工复核 · 需确认:${POLICY_REASON}`,
      'proposed-by': { actor: 'agent' },
      'risk-level': 'high',
      policy: 'builtin:high-agent',
      'policy-reason': POLICY_REASON,
      status,
      ...(decided ? { 'decided-by': { actor: 'human', principal: 'local-user' } } : {}),
      ...(status === 'rejected' ? { 'rejected-reason': '证据不足，先补材料' } : {}),
    },
    actions: decided ? [] : [approveAction(), rejectAction()],
    links: [
      { rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` },
      { rel: ['target'], href: `/api/entity?rel=${encodeURIComponent(targetRel)}` },
      { rel: ['collection'], href: '/api/entity?rel=inbox' },
    ],
    'guard-results': [],
  };
}

function threadEntity(status: 'open' | 'archived', members: SirenEntity[]): SirenEntity {
  return {
    class: ['work-thread', status],
    properties: {
      rel: 'thread:t1',
      id: 't1',
      identity: THREAD_IDENTITY,
      goal: { text: THREAD_IDENTITY, source: 'chat:m0' },
      status,
      statusText: status === 'open' ? '进行中' : '已归档',
      context: [],
      resume: status === 'open' ? '停在「进行中」' : '停在「已归档」',
      active: [],
      approval: members.map((member) => ({
        rel: member.properties.rel,
        status: member.properties.status,
        dangling: false,
      })),
      'recent-events': [],
      presentation: {
        fields: [
          { path: 'properties.identity', title: '目标', role: 'identity' },
          { path: 'properties.statusText', title: '状态', role: 'status' },
        ],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=thread%3At1' }],
    'guard-results': [],
    entities: members,
  };
}

// ---------------------------------------------------------------------------
// 单元面:MemberCardWord 的确认责任卡绑定
// ---------------------------------------------------------------------------

describe('member-card 确认责任卡的知情决定绑定(P3.2 单元面)', () => {
  function renderCard(props: Record<string, unknown>): void {
    render(
      <ActionSubmitProvider
        submit={createDirectActionSubmit(
          vi.fn(async () => ({ ok: true as const, entity: {} as SirenEntity })),
          { clientParams: () => ({}) },
        )}
      >
        <MemberCardWord {...props} />
      </ActionSubmitProvider>,
    );
  }

  const pendingProps = {
    label: 'archive · 由 agent 提议',
    rel: 'confirmation:c1',
    status: 'pending',
    actions: [approveAction(), rejectAction()],
  };

  /** /api/entity 的确认实体形状(读字段在 properties 字典内)。 */
  function pendingDocument(): Record<string, unknown> {
    return {
      class: ['confirmation', 'pending'],
      properties: {
        rel: 'confirmation:c1',
        'target-rel': 'post:post-welcome',
        'target-action': 'archive',
        'policy-reason': POLICY_REASON,
        status: 'pending',
        'proposed-by': { actor: 'agent' },
      },
    };
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('A1/A2:pending 责任卡读出确认实体 → 同卡可读对象/动作/依据,改变前后显式「未提供」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(pendingDocument()), { status: 200 })),
      ),
    );
    renderCard(pendingProps);

    const card = document.querySelector('[data-word="member-card"][data-rel="confirmation:c1"]')!;
    const info = await waitFor(() => {
      const section = card.querySelector('[data-testid="decision-info"]');
      expect(section).not.toBeNull();
      return section!;
    });
    expect(info.textContent).toContain('post:post-welcome');
    expect(info.textContent).toContain('archive');
    expect(info.textContent).toContain(POLICY_REASON);
    const changeRow = info.querySelector('[data-decision-row="change"]');
    expect(changeRow?.textContent).toContain('改变前后');
    expect(changeRow?.textContent).toContain('未提供');
    // 动作组保持可用(非 meta 目标)。
    expect(
      (within(card as HTMLElement).getByRole('button', { name: '批准' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('A8:被引目标是 meta/ 定义 → 不渲染内联 approve,显式跨入治理宿主路由', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              class: ['confirmation', 'pending'],
              properties: {
                rel: 'confirmation:c1',
                'target-rel': 'meta/application:editorial',
                'target-action': 'archive',
                'policy-reason': POLICY_REASON,
                status: 'pending',
                'proposed-by': { actor: 'agent' },
              },
            }),
            { status: 200 },
          ),
        ),
      ),
    );
    renderCard(pendingProps);

    const card = await waitFor(() => {
      const element = document.querySelector(
        '[data-word="member-card"][data-rel="confirmation:c1"]',
      );
      expect(element?.querySelector('a[data-nav="cross:meta-governance"]')).not.toBeNull();
      return element!;
    });
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
    expect(screen.queryByRole('button', { name: '驳回' })).toBeNull();
    const link = card.querySelector<HTMLAnchorElement>('a[data-nav="cross:meta-governance"]')!;
    expect(link.getAttribute('href')).toBe(
      `/meta/entity?rel=${encodeURIComponent('meta/application:editorial')}`,
    );
  });

  it('A6:已决责任卡回读 T54 决定回执(批准/驳回 + 驳回原因),无动作面', async () => {
    const decided = (status: 'approved' | 'rejected'): Record<string, unknown> => ({
      class: ['confirmation', status],
      properties: {
        rel: 'confirmation:c1',
        'target-rel': 'post:post-welcome',
        'target-action': 'archive',
        status,
        'decided-by': { actor: 'human', principal: 'local-user' },
        ...(status === 'rejected' ? { 'rejected-reason': '证据不足，先补材料' } : {}),
      },
    });
    let status: 'approved' | 'rejected' = 'approved';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(decided(status)), { status: 200 }))),
    );
    renderCard({ ...pendingProps, status: 'approved', actions: [] });
    await waitFor(() =>
      expect(document.querySelector('[data-decision-row="receipt"]')).not.toBeNull(),
    );
    expect(document.querySelector('[data-decision-row="receipt"]')?.textContent).toContain(
      '已由 human 批准',
    );
    expect(screen.queryByRole('button')).toBeNull();

    cleanup();
    status = 'rejected';
    renderCard({ ...pendingProps, status: 'rejected', actions: [] });
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('[data-decision-row="receipt"]')].at(-1)?.textContent,
      ).toContain('已由 human 驳回'),
    );
    expect(document.querySelector('[data-decision-row="reject-reason"]')?.textContent).toContain(
      '证据不足，先补材料',
    );
  });

  it('读失败诚实回退:保留身份与合同到达,提供重试而不展示未知目标的决定按钮', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    renderCard(pendingProps);

    expect(screen.getByText('archive · 由 agent 提议')).toBeTruthy();
    expect(screen.getByText(/confirmation:c1/)).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-testid="decision-info"]')).toBeNull());
    expect(await screen.findByRole('button', { name: '重试读取' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('无法读取完整决定信息');
    expect(screen.getByRole('link', { name: 'archive · 由 agent 提议' }).getAttribute('href')).toBe(
      '/canvas?focus=confirmation%3Ac1',
    );
  });
});

// ---------------------------------------------------------------------------
// 集成面:本线 surface 的责任卡决定流(CanvasBody 全管线)
// ---------------------------------------------------------------------------

interface CallRecord {
  method: string;
  url: string;
  body?: unknown;
}

interface Fixture {
  calls: CallRecord[];
  rows: Record<string, SirenEntity>;
  fetchMock: ReturnType<typeof vi.fn>;
  postCount: () => number;
}

function contract(): Fixture {
  const calls: CallRecord[] = [];
  const rows: Record<string, SirenEntity> = {
    'thread:t1': threadEntity('open', [
      approvalMember('confirmation:c1', 'archive', 'pending'),
      approvalMember('confirmation:c2', 'deprecate', 'pending'),
    ]),
    'confirmation:c1': confirmationEntity('confirmation:c1', 'post:post-welcome', 'pending'),
    'confirmation:c2': confirmationEntity(
      'confirmation:c2',
      'meta/application:editorial',
      'pending',
    ),
  };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const isExecPost = url === '/api/exec' && init?.method === 'POST';
    if (!isExecPost) calls.push({ method: init?.method ?? 'GET', url });
    if (url === '/api/render/catalog') {
      return Promise.resolve(jsonResponse(200, renderCatalogJson()));
    }
    if (url.startsWith('/.well-known/ui4a.json')) {
      return Promise.resolve(jsonResponse(200, { version: 'definition-v1' }));
    }
    if (isExecPost) {
      calls.push({
        method: 'POST',
        url,
        body: JSON.parse(String(init.body)) as unknown,
      });
      const decided = decideC1(rows);
      return Promise.resolve(jsonResponse(200, { entity: decided, subject: decided }));
    }
    if (url.startsWith('/api/entity?rel=')) {
      calls.push({ method: 'GET', url });
      const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel') ?? '';
      const entity = rows[rel];
      return Promise.resolve(
        entity === undefined
          ? jsonResponse(404, { error: 'not found' })
          : jsonResponse(200, entity),
      );
    }
    return Promise.resolve(jsonResponse(404, { error: `unknown ${url}` }));
  });
  return {
    calls,
    rows,
    fetchMock,
    postCount: () => calls.filter((call) => call.method === 'POST').length,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** POST /api/exec 的成功裁决:确认 c1 与线成员卡同位落 decided(服务端是身份权威)。 */
function decideC1(rows: Record<string, SirenEntity>): SirenEntity {
  const decided = confirmationEntity('confirmation:c1', 'post:post-welcome', 'approved');
  rows['confirmation:c1'] = decided;
  const thread = rows['thread:t1']!;
  thread.entities = (thread.entities ?? []).map((member) =>
    member.properties.rel === 'confirmation:c1'
      ? {
          ...member,
          properties: { ...member.properties, status: 'approved' },
          actions: [],
        }
      : member,
  );
  return decided;
}

async function renderThreadWorkspace(query: string): Promise<Fixture> {
  window.history.pushState({}, '', `/canvas?${query}`);
  const fixture = contract();
  vi.stubGlobal('fetch', fixture.fetchMock);
  render(<CanvasBody />);
  await screen.findByText(THREAD_IDENTITY);
  return fixture;
}

function cardOf(rel: string): HTMLElement {
  const card = document.querySelector(`[data-word="member-card"][data-rel="${rel}"]`);
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

async function confirmApprove(scope: HTMLElement): Promise<void> {
  fireEvent.click(within(scope).getByRole('button', { name: '批准' }));
  fireEvent.click(await within(scope).findByRole('button', { name: '确认并执行批准' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
  globalThis.localStorage?.clear();
});

describe('本线责任卡决定流(P3.2 集成面;US02/US04)', () => {
  it('A1/A2:同一主面可读目标/动作/依据与「未提供」;A8 meta 责任卡不渲染内联批准', async () => {
    await renderThreadWorkspace('thread=t1&focus=thread%3At1');

    const business = await waitFor(() => {
      const card = cardOf('confirmation:c1');
      expect(card.querySelector('[data-testid="decision-info"]')).not.toBeNull();
      return card;
    });
    const info = business.querySelector('[data-testid="decision-info"]')!;
    expect(info.textContent).toContain('post:post-welcome');
    expect(info.textContent).toContain('archive');
    expect(info.textContent).toContain(POLICY_REASON);
    expect(info.querySelector('[data-decision-row="change"]')?.textContent).toContain('未提供');

    // A8:meta 责任卡(本线内联面退场,治理宿主链接在场)。
    const meta = cardOf('confirmation:c2');
    await waitFor(() =>
      expect(meta.querySelector('a[data-nav="cross:meta-governance"]')).not.toBeNull(),
    );
    expect(within(meta).queryByRole('button', { name: '批准' })).toBeNull();
    expect(
      meta
        .querySelector<HTMLAnchorElement>('a[data-nav="cross:meta-governance"]')
        ?.getAttribute('href'),
    ).toBe(`/meta/entity?rel=${encodeURIComponent('meta/application:editorial')}`);
  });

  it('A3/A5:批准提交前 fresh read,POST /api/exec 走原闸门,身份固定 human 渲染信道', async () => {
    const { calls } = await renderThreadWorkspace('thread=t1&focus=thread%3At1');

    const business = await waitFor(() => {
      const card = cardOf('confirmation:c1');
      expect(within(card).getByRole('button', { name: '批准' })).toBeTruthy();
      return card;
    });
    const before = calls.length;
    await confirmApprove(business);

    const postIndex = await waitFor(() => {
      const index = calls.findIndex(
        (call, position) => position >= before && call.method === 'POST',
      );
      expect(index).toBeGreaterThan(-1);
      return index;
    });
    // fresh read 先于提交(动作来自当前 Siren)。
    const freshReads = calls
      .slice(before, postIndex)
      .filter((call) => call.method === 'GET' && call.url.includes('rel=confirmation%3Ac1'));
    expect(freshReads.length).toBeGreaterThan(0);
    // A5:提交身份 = human 渲染信道,无任何身份改写面。
    expect(calls[postIndex]!.body).toEqual({
      rel: 'confirmation:c1',
      action: 'approve',
      actor: 'human',
      principal: 'local-user',
      channel: 'renderer',
    });
  });

  it('A4:已决确认的陈旧动作提交被拦截 → 诚实失败、零第二次事件', async () => {
    const fixture = await renderThreadWorkspace('thread=t1&focus=thread%3At1');
    const business = await waitFor(() => {
      const card = cardOf('confirmation:c1');
      expect(within(card).getByRole('button', { name: '批准' })).toBeTruthy();
      return card;
    });

    // 另一执行者已裁决同一确认(本 surface 仍持陈旧 pending 卡)。
    fixture.rows['confirmation:c1'] = confirmationEntity(
      'confirmation:c1',
      'post:post-welcome',
      'rejected',
    );
    const before = fixture.calls.length;
    await confirmApprove(business);

    await waitFor(() =>
      expect(within(business).getByRole('alert').textContent).toMatch(/action-undeclared/),
    );
    expect(within(business).getByRole('alert').textContent).toContain('confirmation:c1');
    expect(fixture.calls.slice(before).some((call) => call.method === 'POST')).toBe(false);
  });

  it('A6:决定后回读——回执保留可读、状态回读更新、过时动作消失', async () => {
    await renderThreadWorkspace('thread=t1&focus=thread%3At1');
    const business = await waitFor(() => {
      const card = cardOf('confirmation:c1');
      expect(within(card).getByRole('button', { name: '批准' })).toBeTruthy();
      return card;
    });

    await confirmApprove(business);

    // 整面 reload 后:c1 回执可读、动作组消失;c2 的 meta 边界在回读后保持。
    await screen.findByText('已由 human 批准');
    const decided = cardOf('confirmation:c1');
    expect(decided.querySelector('[data-decision-row="receipt"]')?.textContent).toContain(
      '已由 human 批准',
    );
    expect(within(decided).queryByRole('button', { name: '批准' })).toBeNull();
    const metaAfterReload = await waitFor(() => {
      const card = cardOf('confirmation:c2');
      expect(card.querySelector('a[data-nav="cross:meta-governance"]')).not.toBeNull();
      return card;
    });
    expect(within(metaAfterReload).queryByRole('button', { name: '批准' })).toBeNull();
  });

  it('A7:archived 线的 pending 责任卡仍可达、动作可提交(US04)', async () => {
    window.history.pushState({}, '', '/canvas?thread=t1&focus=thread%3At1');
    const fixture = contract();
    fixture.rows['thread:t1'] = threadEntity('archived', [
      approvalMember('confirmation:c1', 'archive', 'pending'),
    ]);
    vi.stubGlobal('fetch', fixture.fetchMock);
    render(<CanvasBody />);
    await screen.findByText(THREAD_IDENTITY);

    // 归档线自身无生命周期动作;责任卡不因归档消失。
    expect(screen.queryByRole('button', { name: '归档工作线' })).toBeNull();
    const business = await waitFor(() => {
      const card = cardOf('confirmation:c1');
      expect(within(card).getByRole('button', { name: '批准' })).toBeTruthy();
      return card;
    });
    await confirmApprove(business);
    await waitFor(() => expect(fixture.postCount()).toBe(1));
  });
});
