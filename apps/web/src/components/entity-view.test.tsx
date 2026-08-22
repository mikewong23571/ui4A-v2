// @vitest-environment jsdom
/**
 * :form runner 组件测试(T2 Phase F / Task F1,arch-brief §7、§11 铁律 3)。
 *
 * 覆盖 spec FR8 的人类路径合同面:
 * - actions[] 有 fields → RJSF 表单(text/select/textarea 三控件);无 fields → 按钮;
 * - 提交统一走 POST /api/exec(actor=human, principal=local-user, channel=renderer);
 * - 拒绝如实呈现(layer/reason),成功回调刷新;
 * - guard-results 的谓词投影:blocked → 按钮 disabled + title 显原因;
 * - 铁律 3 组件级断言:业务 form/button 全部映射已声明 action;
 *   展开/取消单独标记为 presentation interaction,不伪装成业务 action;
 * - links[]/entities[] 渲染为 renderer 导航链接(/entity?rel=…)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { ActionRunner } from './action-runner';
import { EntityView } from './entity-view';

// ---- fixtures(形状与 /api/entity 的 Siren 投影一致)-------------------------

const publishAction: SirenAction = {
  name: 'publish',
  title: '发布',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      title: { type: 'string', title: '标题' },
      category: { type: 'string', title: '分类', enum: ['tech', 'essay', 'review'] },
      body: { type: 'string', title: '正文', format: 'textarea' },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  },
};

const resetAction: SirenAction = {
  name: 'reset',
  title: '重置',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const wizardEntity: SirenEntity = {
  class: ['flow-instance', 'article-drafting'],
  properties: {
    rel: 'article-drafting:main',
    flow: 'article-drafting',
    node: 'ready',
    title: '就绪',
    fields: { title: '草稿标题' },
  },
  actions: [publishAction, resetAction],
  links: [
    { rel: ['self'], href: '/api/entity?rel=article-drafting:main' },
    { rel: ['collection'], href: '/api/entity?rel=articles' },
    { rel: ['flow'], href: '/api/entity?rel=flow:article-drafting' },
  ],
  'guard-results': [
    { action: 'publish', blocked: false, guards: [] },
    { action: 'reset', blocked: true, reason: 'guard 不满足: is-pending=false', guards: [] },
  ],
};

const articlesEntity: SirenEntity = {
  class: ['collection', 'articles'],
  properties: { rel: 'articles', count: 2 },
  actions: [],
  links: [
    { rel: ['self'], href: '/api/entity?rel=articles' },
    { rel: ['flow'], href: '/api/entity?rel=flow:article-drafting' },
  ],
  'guard-results': [],
  entities: [
    {
      class: ['flow-instance', 'post-status'],
      rel: ['item'],
      href: '/api/entity?rel=post:post-welcome',
      properties: {
        rel: 'post:post-welcome',
        node: 'published',
        title: '已发布',
        fields: { title: '欢迎来到 UI4A' },
      },
      actions: [],
      links: [],
    },
  ],
};

// ---- 确认门 fixtures(T3 Phase D;形状与 projectConfirmation 一致)-----------

const approveAction: SirenAction = {
  name: 'approve',
  title: '批准',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const rejectAction: SirenAction = {
  name: 'reject',
  title: '驳回',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { reason: { type: 'string', format: 'textarea', minLength: 1 } },
    required: ['reason'],
    additionalProperties: false,
  },
};

/** 投影 guard-results:actor-is-human 无 actor 上下文 fail-closed(engine 口径)。 */
const actorGuardBlocked = (action: string) => ({
  action,
  blocked: true,
  reason: 'guard 不满足: actor-is-human=false',
  guards: [{ name: 'actor-is-human', pass: false }],
});

function confirmationEntity(overrides: Record<string, unknown> = {}): SirenEntity {
  return {
    class: ['confirmation', 'pending'],
    properties: {
      id: 'c1',
      'target-rel': 'post:post-welcome',
      'target-action': 'archive',
      params: {},
      'proposed-by': { actor: 'agent', principal: 'user:mike' },
      channel: 'e2e',
      'risk-level': 'high',
      policy: 'cedar:confirm-high-risk',
      'policy-reason': '高风险动作由 agent 提议，需人类确认',
      status: 'pending',
      notified: true,
      ...overrides,
    },
    actions: [approveAction, rejectAction],
    links: [
      { rel: ['self'], href: '/api/entity?rel=confirmation:c1' },
      { rel: ['target'], href: '/api/entity?rel=post:post-welcome' },
    ],
    'guard-results': [actorGuardBlocked('approve'), actorGuardBlocked('reject')],
  };
}

const inboxEntity: SirenEntity = {
  class: ['collection', 'inbox'],
  properties: { rel: 'inbox', count: 1, delivered: 1 },
  actions: [],
  links: [{ rel: ['self'], href: '/api/entity?rel=inbox' }],
  'guard-results': [],
  entities: [
    {
      ...confirmationEntity(),
      rel: ['item'],
      href: '/api/entity?rel=confirmation:c1',
    },
  ],
};

// ---- harness -----------------------------------------------------------------

function mockFetch(status: number, body: unknown) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? 'GET') === 'GET' && url.startsWith('/api/entity?rel=')) {
      const rel = new URL(url, 'http://ui4a.test').searchParams.get('rel') ?? '';
      const supplied =
        typeof body === 'object' && body !== null && 'entity' in body
          ? (body as { entity: SirenEntity }).entity
          : wizardEntity;
      return Promise.resolve(
        new Response(JSON.stringify({ ...supplied, properties: { ...supplied.properties, rel } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

function execCallsOf(mock: ReturnType<typeof vi.fn>): Array<[string, RequestInit]> {
  return mock.mock.calls.filter(
    ([input, init]) =>
      String(input) === '/api/exec' && (init as RequestInit | undefined)?.method === 'POST',
  ) as Array<[string, RequestInit]>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- ActionRunner --------------------------------------------------------------

describe('ActionRunner:actions → RJSF 表单/按钮', () => {
  it('有 fields → RJSF 表单逐字段渲染(text 输入框、enum 下拉、textarea 文本域)', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    render(<ActionRunner rel="article-drafting:main" action={publishAction} />);

    expect(screen.getByLabelText(/标题/)).toBeTruthy();
    const category = screen.getByLabelText(/分类/) as HTMLSelectElement;
    expect(category.tagName).toBe('SELECT');
    // RJSF 缺省 indexed 编码:option value=索引,label=枚举值(解码回真实值)
    expect([...category.options].map((option) => option.label)).toEqual(
      expect.arrayContaining(['tech', 'essay', 'review']),
    );
    expect((screen.getByLabelText(/正文/) as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
    expect(screen.getByRole('button', { name: '发布' })).toBeTruthy();
  });

  it('无 fields → 渲染按钮而非表单', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    const { container } = render(<ActionRunner rel="article-drafting:main" action={resetAction} />);

    expect(screen.getByRole('button', { name: '重置' })).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
  });

  it('提交走 /api/exec:actor=human, principal=local-user, channel=renderer', async () => {
    const fetchMock = mockFetch(200, { entity: wizardEntity });
    vi.stubGlobal('fetch', fetchMock);
    const onExecuted = vi.fn();
    render(
      <ActionRunner rel="article-drafting:main" action={publishAction} onExecuted={onExecuted} />,
    );

    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '第三篇' } });
    // indexed 编码:DOM value 是索引 0,formData 解码回 'tech'
    fireEvent.change(screen.getByLabelText(/分类/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/正文/), { target: { value: '正文内容' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    await waitFor(() => expect(execCallsOf(fetchMock)).toHaveLength(1));
    const [url, init] = execCallsOf(fetchMock)[0]!;
    expect(url).toBe('/api/exec');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      rel: 'article-drafting:main',
      action: 'publish',
      params: { title: '第三篇', category: 'tech', body: '正文内容' },
      actor: 'human',
      principal: 'local-user',
      channel: 'renderer',
    });
    await waitFor(() => expect(onExecuted).toHaveBeenCalled());
  });

  it('按钮(无 fields)提交同样走 /api/exec 并带固定身份', async () => {
    const fetchMock = mockFetch(200, { entity: wizardEntity });
    vi.stubGlobal('fetch', fetchMock);
    render(<ActionRunner rel="post:post-welcome" action={resetAction} />);

    fireEvent.click(screen.getByRole('button', { name: '重置' }));

    await waitFor(() => expect(execCallsOf(fetchMock)).toHaveLength(1));
    expect(JSON.parse(String(execCallsOf(fetchMock)[0]![1].body))).toEqual({
      rel: 'post:post-welcome',
      action: 'reset',
      actor: 'human',
      principal: 'local-user',
      channel: 'renderer',
    });
  });

  it('拒绝如实呈现 layer 与 reason,不触发成功回调', async () => {
    const fetchMock = mockFetch(422, {
      layer: 'guard-failed',
      reason: 'guard 不满足: title-not-taken=false',
    });
    vi.stubGlobal('fetch', fetchMock);
    const onExecuted = vi.fn();
    render(
      <ActionRunner rel="article-drafting:main" action={publishAction} onExecuted={onExecuted} />,
    );

    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '重名标题' } });
    fireEvent.change(screen.getByLabelText(/正文/), { target: { value: '正文' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('guard-failed');
    expect(alert.textContent).toContain('title-not-taken');
    expect(onExecuted).not.toHaveBeenCalled();
  });
});

describe('ActionRunner:guard-results 谓词投影', () => {
  it('blocked → 按钮 disabled 且 title 显示原因', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    const { container } = render(
      <ActionRunner
        rel="article-drafting:main"
        action={resetAction}
        blocked
        blockReason="guard 不满足: is-pending=false"
      />,
    );

    const button = screen.getByRole('button', { name: '重置' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('is-pending');
    // disabled 状态下不渲染表单交互(无 fields 路径同样受控)
    expect(container.querySelector('form')).toBeNull();
  });

  it('有 fields 且 blocked → 表单提交按钮 disabled + title 原因', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    render(
      <ActionRunner
        rel="article-drafting:main"
        action={publishAction}
        blocked
        blockReason="guard 不满足: title-not-taken=false"
      />,
    );

    const button = screen.getByRole('button', { name: '发布' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain('title-not-taken');
  });
});

// ---- EntityView ----------------------------------------------------------------

describe('EntityView:实体四件组装渲染', () => {
  it('铁律 3:渲染的 form/button 全部来自 actions[](零合同外可提交元素)', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    const { container } = render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    const declared = new Set(wizardEntity.actions.map((action) => action.name));
    const businessControls = [
      ...container.querySelectorAll<HTMLFormElement>('form'),
      ...container.querySelectorAll<HTMLButtonElement>('button[data-action]'),
    ];
    // publish(RJSF 表单 + 提交按钮)+ reset(按钮);展开/取消是
    // presentation interaction，不伪装成业务 action。
    expect(businessControls.length).toBe(3);
    for (const element of businessControls) {
      const endorsed =
        element.dataset.action ??
        (element.closest('[data-action]') as HTMLElement | null)?.dataset.action;
      expect(declared.has(String(endorsed)), `元素 ${element.outerHTML} 须背书已声明 action`).toBe(
        true,
      );
    }
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-presentation-action]')].map(
        (element) => element.dataset.presentationAction,
      ),
    ).toEqual(['open-form', 'cancel-form']);
  });

  it('links[] 渲染为 renderer 导航链接(/entity?rel=…)', () => {
    const { container } = render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>('a')].map((a) => a.href);
    expect(hrefs).toContain('http://localhost:3000/entity?rel=articles');
    expect(hrefs).toContain('http://localhost:3000/entity?rel=article-drafting%3Amain');
    expect(hrefs).toContain('http://localhost:3000/entity?rel=flow%3Aarticle-drafting');
  });

  it('集合子实体 entities[] 渲染为成员链接(含标题与节点)', () => {
    const { container } = render(<EntityView rel="articles" entity={articlesEntity} />);

    const anchor = container.querySelector<HTMLAnchorElement>('a[href*="post%3Apost-welcome"]');
    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toContain('欢迎来到 UI4A');
    expect(anchor!.textContent).toContain('published');
  });

  it('properties 简表呈现字段值', () => {
    render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    expect(screen.getByText(/草稿标题/)).toBeTruthy();
    expect(screen.getByText('ready')).toBeTruthy();
  });

  it('blocked 的 guard-results 注入 disabled(整页接线)', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    const reset = screen.getByRole('button', { name: '重置' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    expect(reset.title).toContain('is-pending');
    const publish = screen.getByRole('button', { name: '发布' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
  });

  it('节点切换后表单不携带前节点字段(向导三步零状态泄漏)', async () => {
    // 复刻向导真实序列:basic-info(title)→ 提交 → 同一页面位置重渲染为
    // classification(category/tags)。RJSF 内部 formData 是组件态,若实例被
    // React 复用,step1 的 title 会漏进 step2 的提交(additionalProperties:
    // false 拒绝)。Renderer 必须随 action schema 换代表单实例。
    const stepOne: SirenEntity = {
      ...wizardEntity,
      properties: { ...wizardEntity.properties, node: 'basic-info', title: '基本信息' },
      actions: [
        {
          name: 'next',
          title: '下一步',
          method: 'POST',
          href: '/api/exec',
          fields: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title'],
            additionalProperties: false,
          },
        },
      ],
      'guard-results': [{ action: 'next', blocked: false, guards: [] }],
    };
    const stepTwo: SirenEntity = {
      ...wizardEntity,
      properties: { ...wizardEntity.properties, node: 'classification', title: '分类' },
      actions: [
        {
          name: 'next',
          title: '下一步',
          method: 'POST',
          href: '/api/exec',
          fields: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              category: { type: 'string', enum: ['tech', 'essay', 'review'] },
              tags: { type: 'string' },
            },
            required: ['category'],
            additionalProperties: false,
          },
        },
      ],
      'guard-results': [{ action: 'next', blocked: false, guards: [] }],
    };

    const fetchMock = mockFetch(200, { entity: stepTwo });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<EntityView rel="article-drafting:main" entity={stepOne} />);

    // step1:填 title → 下一步
    fireEvent.change(screen.getByLabelText(/title/), { target: { value: '第三篇' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(execCallsOf(fetchMock)).toHaveLength(1));

    // exec 成功后页面刷新为 step2 的实体投影(rerender 同一组件树)
    view.rerender(<EntityView rel="article-drafting:main" entity={stepTwo} />);

    // step2:选 category → 下一步;提交参数不得携带 step1 的 title
    fireEvent.change(screen.getByLabelText(/category/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(execCallsOf(fetchMock)).toHaveLength(2));

    const body = JSON.parse(String(execCallsOf(fetchMock)[1]![1].body)) as Record<string, unknown>;
    expect(body.action).toBe('next');
    expect(body.params).toEqual({ category: 'tech' });
  });
});

// ---- T14 Phase A:人话 label / 预填 / 属性表口径(#3/#4 表单与属性表侧)---------

/** seed 口径的 publish:field-definition 的 title/description 已由引擎派生进 schema。 */
const seedPublishAction: SirenAction = {
  name: 'publish',
  title: '发布',
  method: 'POST',
  href: '/api/exec',
  fields: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      title: {
        type: 'string',
        title: '文章标题',
        description: '用于生成文章地址(slug),与前序所填一致',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
};

describe('ActionRunner:人话 label 与字段说明(T14 Phase A,#3/#4 表单侧)', () => {
  it('字段 label 取 schema.title 的人话标题,机器名不上屏;description 呈现为字段说明', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    render(<ActionRunner rel="article-drafting:main" action={seedPublishAction} />);

    expect(screen.getByLabelText(/文章标题/)).toBeTruthy();
    // 机器字段名不作为 label 上屏(label 位已被人话标题占据)
    expect(screen.queryByLabelText(/^title$/)).toBeNull();
    expect(screen.getByText(/用于生成文章地址/)).toBeTruthy();
  });
});

describe('ActionRunner:实例字段预填(T14 Phase A,#4)', () => {
  it('动作字段与实例字段同名 → 表单以实例值预填;实例没有的字段不预填', () => {
    vi.stubGlobal('fetch', mockFetch(200, { entity: wizardEntity }));
    render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    // wizardEntity.fields = { title: '草稿标题' };publishAction 声明 title/category/body
    expect((screen.getByLabelText(/标题/) as HTMLInputElement).value).toBe('草稿标题');
    expect((screen.getByLabelText(/正文/) as HTMLTextAreaElement).value).toBe('');
  });

  it('预填只欠确认:补齐其余必填直接提交,同名字段参数 = 实例值', async () => {
    const fetchMock = mockFetch(200, { entity: wizardEntity });
    vi.stubGlobal('fetch', fetchMock);
    render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    fireEvent.change(screen.getByLabelText(/正文/), { target: { value: '正文内容' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    await waitFor(() => expect(execCallsOf(fetchMock)).toHaveLength(1));
    const body = JSON.parse(String(execCallsOf(fetchMock)[0]![1].body)) as {
      params: Record<string, unknown>;
    };
    expect(body.params.title).toBe('草稿标题');
    expect(body.params.body).toBe('正文内容');
  });

  it('预填值可被改写:提交以用户确认的参数为准', async () => {
    const fetchMock = mockFetch(200, { entity: wizardEntity });
    vi.stubGlobal('fetch', fetchMock);
    render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);

    fireEvent.change(screen.getByLabelText(/标题/), { target: { value: '改过的标题' } });
    fireEvent.change(screen.getByLabelText(/正文/), { target: { value: '正文' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));

    await waitFor(() => expect(execCallsOf(fetchMock)).toHaveLength(1));
    const body = JSON.parse(String(execCallsOf(fetchMock)[0]![1].body)) as {
      params: Record<string, unknown>;
    };
    expect(body.params.title).toBe('改过的标题');
  });

  it('预填只取 schema 声明的标量字段(合同外键与非标量值不进表单)', async () => {
    const fetchMock = mockFetch(200, { entity: wizardEntity });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <ActionRunner
        rel="article-drafting:main"
        action={seedPublishAction}
        prefill={{ title: '草稿标题', category: 'tech', meta: { nested: 1 } }}
      />,
    );

    expect((screen.getByLabelText(/文章标题/) as HTMLInputElement).value).toBe('草稿标题');
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() => expect(execCallsOf(fetchMock)).toHaveLength(1));
    const body = JSON.parse(String(execCallsOf(fetchMock)[0]![1].body)) as {
      params: Record<string, unknown>;
    };
    expect(body.params).toEqual({ title: '草稿标题' });
  });
});

describe('EntityView:属性表人话口径(T14 Phase A,#3 属性表侧)', () => {
  it('title 投影不再上表(h1 已呈现);rel/flow/node 合同标识保留原样', () => {
    const { container } = render(<EntityView rel="article-drafting:main" entity={wizardEntity} />);
    const section = container.querySelector('section[aria-label="属性"]');
    expect(section).not.toBeNull();
    const headers = [...(section?.querySelectorAll('th') ?? [])].map((th) => th.textContent);
    expect(headers).not.toContain('title');
    expect(headers).not.toContain('fields');
    expect(headers).toEqual(expect.arrayContaining(['rel', 'flow', 'node', '字段值']));
    // 节点标题投影仍是页面主标题(属性表不再重复)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('就绪');
  });

  it('实例字段值以人话标签呈现;未知字段名原样(零发明,不造标签)', () => {
    const entity: SirenEntity = {
      ...wizardEntity,
      properties: {
        ...wizardEntity.properties,
        fields: { title: '草稿标题', mystery: 'x' },
      },
    };
    render(<EntityView rel="article-drafting:main" entity={entity} />);

    expect(screen.getByText('文章标题=草稿标题 · mystery=x')).toBeTruthy();
  });
});

// ---- 确认门渲染(T3 Phase D / Task D1)--------------------------------------

describe('EntityView:确认实体与 inbox 集合渲染', () => {
  it('inbox 成员:确认条目含目标动作与提议者,逐条链接到 /entity?rel=confirmation:<id>', () => {
    const { container } = render(<EntityView rel="inbox" entity={inboxEntity} />);

    const anchor = container.querySelector<HTMLAnchorElement>('a[href*="confirmation%3Ac1"]');
    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toContain('target-action=archive');
    expect(anchor!.textContent).toContain('proposed-by.actor=agent');
    expect(anchor!.textContent).toContain('proposed-by.principal=user:mike');
    expect(anchor!.textContent).toContain('status=pending');
    expect(anchor!.href).toBe('http://localhost:3000/entity?rel=confirmation%3Ac1');
  });

  it('确认实体页:批准为推送按钮、驳回为 RJSF 表单且 reason 必填', () => {
    const { container } = render(
      <EntityView rel="confirmation:c1" entity={confirmationEntity()} />,
    );

    const approve = screen.getByRole('button', { name: '批准' }) as HTMLButtonElement;
    expect(approve.dataset.action).toBe('approve');
    const reason = container.querySelector<HTMLTextAreaElement>('textarea[required]');
    expect(reason).not.toBeNull();
    expect(reason!.hasAttribute('required')).toBe(true);
    // 提交面铁律 3:两个可提交元素分别背书 approve/reject
    expect(container.querySelectorAll('[data-action="approve"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-action="reject"]').length).toBeGreaterThan(0);
  });

  it('确认实体页机械呈现人话风险、挂起原因与提议者，不输出 [object Object]', () => {
    const { container } = render(
      <EntityView rel="confirmation:c1" entity={confirmationEntity()} />,
    );

    expect(screen.getByText('风险等级')).toBeTruthy();
    expect(screen.getByText('高')).toBeTruthy();
    expect(screen.getByText('挂起原因')).toBeTruthy();
    expect(screen.getByText('高风险动作由 agent 提议，需人类确认')).toBeTruthy();
    expect(screen.getByText('agent · user:mike')).toBeTruthy();
    expect(container.textContent).not.toContain('[object Object]');
  });

  it('renderer 身份规则:投影 fail-closed 的 actor-is-human 不禁用批准/驳回(人类路径)', () => {
    render(<EntityView rel="confirmation:c1" entity={confirmationEntity()} />);

    const approve = screen.getByRole('button', { name: '批准' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    const reject = screen.getByRole('button', { name: '驳回' }) as HTMLButtonElement;
    expect(reject.disabled).toBe(false);
  });

  it('状态类 guard 失败仍禁用(renderer 身份规则只解除 actor-is-human)', () => {
    const entity = confirmationEntity({
      'target-action': 'unpublish',
    });
    entity['guard-results'] = [
      {
        action: 'approve',
        blocked: true,
        reason: 'guard 不满足: actor-is-human=false, is-published=false',
        guards: [
          { name: 'actor-is-human', pass: false },
          { name: 'is-published', pass: false },
        ],
      },
      actorGuardBlocked('reject'),
    ];
    render(<EntityView rel="confirmation:c1" entity={entity} />);

    const approve = screen.getByRole('button', { name: '批准' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    // reject 只挂 actor-is-human → 解除
    const reject = screen.getByRole('button', { name: '驳回' }) as HTMLButtonElement;
    expect(reject.disabled).toBe(false);
  });
});
