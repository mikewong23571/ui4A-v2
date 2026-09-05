// @vitest-environment jsdom
/**
 * G07 DoD2/3/4:对象选择器(ObjectSelectorPanel)候选面的组件契约。
 *
 * - 候选标题可区分:消费成员合同的声明字段(identity 角色字段值 → 声明
 *   primary-content/overview 字段值,如评论正文),如实使用不猜测;全组只剩
 *   集合级同名兜底(如 flow 标题)时退 rel——「所有候选都叫『评论审核』」
 *   不再发生(R08 证据);
 * - 已在本线(context)成员禁选并标注;移出语义不在本组件(合同 detach);
 * - 候选只来自授权读面(sitemap 集合面 + 页面缓存实体读);读不到的集合
 *   不入候选,不得自造清单。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { ObjectSelectorPanel } from './thread-desk-selector';
import { EntityCacheProvider } from '../../entity-cache-provider';

function commentMember(rel: string, body: string): SirenEntity {
  return {
    class: ['flow-instance', 'comment-moderation'],
    properties: {
      rel,
      flow: 'comment-moderation',
      node: 'pending',
      // 引擎回退:flow 未声明 identity 字段时,identity = flow 标题(全组同名)。
      identity: '评论审核',
      title: '待处理',
      status: 'pending',
      fields: { body, status: 'pending' },
      presentation: {
        version: 1,
        fields: [
          {
            path: 'properties.fields.body',
            title: '评论内容',
            role: 'primary-content',
            overview: true,
          },
          { path: 'properties.fields.status', title: '状态', role: 'status' },
        ],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${rel}` }],
  };
}

function ideaMember(rel: string, title: string, insight: string): SirenEntity {
  return {
    class: ['flow-instance', 'idea-item'],
    properties: {
      rel,
      identity: title,
      title: '发展中',
      status: 'developing',
      fields: { title, insight },
      presentation: {
        version: 1,
        fields: [
          { path: 'properties.fields.title', title: '想法标题', role: 'identity', overview: true },
          { path: 'properties.fields.insight', title: '发展内容', role: 'primary-content' },
        ],
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${rel}` }],
  };
}

function bareMember(rel: string, sharedIdentity: string): SirenEntity {
  return {
    class: ['flow-instance', 'static-review'],
    properties: { rel, identity: sharedIdentity, title: '待处理', status: 'pending' },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${rel}` }],
  };
}

function collectionEntity(rel: string, title: string, members: SirenEntity[]): SirenEntity {
  return {
    class: ['collection', rel],
    properties: { rel, title, count: members.length },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${rel}` }],
    entities: members.map((member) => ({
      ...member,
      rel: ['item'],
      href: `/api/entity?rel=${member.properties.rel}`,
    })),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPanel(
  entities: Record<string, SirenEntity | null>,
  surfaces: Array<Record<string, unknown>>,
  attachedRels: ReadonlySet<string> = new Set(),
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('ui4a.json')) {
        return jsonResponse({ version: 'v-test', surfaces });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return render(
    <EntityCacheProvider
      fetcher={async (rel) => entities[rel] ?? null}
      versionFetcher={async () => 'v-test'}
    >
      <ObjectSelectorPanel
        attachedRels={attachedRels}
        busy={false}
        onPick={vi.fn(async () => true)}
        onClose={() => undefined}
      />
    </EntityCacheProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectSelectorPanel 候选标题(G07 DoD2:可区分、声明驱动)', () => {
  it('未声明 identity 字段的成员用声明内容字段(评论正文)作标题,flow 标题不再充当全部候选名', async () => {
    renderPanel(
      {
        comments: collectionEntity('comments', '评论', [
          commentMember('comment:c1', '首页配色太刺眼'),
          commentMember('comment:c2', '希望支持暗色模式'),
        ]),
      },
      [{ rel: 'comments', title: '评论', collection: true }],
    );
    expect(await screen.findByText('首页配色太刺眼')).toBeTruthy();
    expect(screen.getByText('希望支持暗色模式')).toBeTruthy();
    // R08:候选不再全部叫「评论审核」(那是 flow 标题兜底,零区分度)。
    expect(screen.queryByText('评论审核')).toBeNull();
  });

  it('声明了 identity 字段的成员按合同标题如实使用(不被内容字段或 rel 覆盖)', async () => {
    renderPanel(
      {
        ideas: collectionEntity('ideas', '想法', [
          ideaMember('idea:ux0905', 'UX0905 减少评审验证税', '确认卡同面展示对象名'),
          ideaMember('idea:ux0905-2', 'UX0905 连续编辑回归', '工作区不预填现值'),
        ]),
      },
      [{ rel: 'ideas', title: '想法', collection: true }],
    );
    expect(await screen.findByText('UX0905 减少评审验证税')).toBeTruthy();
    expect(screen.getByText('UX0905 连续编辑回归')).toBeTruthy();
    // identity 角色字段优先:primary-content(发展内容)不作标题。
    expect(screen.queryByText('确认卡同面展示对象名')).toBeNull();
  });

  it('成员无逐字段声明且投影身份全组同名时退 rel(缺标题用 rel,不猜测标题)', async () => {
    renderPanel(
      {
        statics: collectionEntity('statics', '静态评审', [
          bareMember('static:a', '静态评审'),
          bareMember('static:b', '静态评审'),
        ]),
      },
      [{ rel: 'statics', title: '静态评审', collection: true }],
    );
    const first = await screen.findByTestId('desk-selector-pick:static:a');
    const second = screen.getByTestId('desk-selector-pick:static:b');
    expect(first.textContent).toContain('static:a');
    expect(second.textContent).toContain('static:b');
    expect(first.textContent).not.toContain('静态评审');
  });
});

describe('ObjectSelectorPanel 授权读面与已添加约束(G07 DoD3/DoD4)', () => {
  it('已在本线的成员禁选并标注,不可重复提交', async () => {
    renderPanel(
      {
        comments: collectionEntity('comments', '评论', [
          commentMember('comment:c1', '首页配色太刺眼'),
          commentMember('comment:c2', '希望支持暗色模式'),
        ]),
      },
      [{ rel: 'comments', title: '评论', collection: true }],
      new Set(['comment:c1']),
    );
    const attached = await screen.findByTestId('desk-selector-pick:comment:c1');
    expect((attached as HTMLButtonElement).disabled).toBe(true);
    expect(attached.textContent).toContain('已在本线');
    expect(
      (screen.getByTestId('desk-selector-pick:comment:c2') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('候选只来自授权读面:集合实体读不到(如无权限)的集合整体不可见,不自造清单', async () => {
    renderPanel(
      { comments: collectionEntity('comments', '评论', [commentMember('comment:c1', '第一条')]) },
      [
        { rel: 'comments', title: '评论', collection: true },
        { rel: 'secrets', title: '未授权集合', collection: true },
        { rel: 'flow:comment-moderation', title: 'flow 面不是集合' },
      ],
    );
    expect(await screen.findByText('第一条')).toBeTruthy();
    expect(screen.queryByText('未授权集合')).toBeNull();
    expect(screen.queryByTestId('desk-selector-pick:flow:comment-moderation')).toBeNull();
  });
});
