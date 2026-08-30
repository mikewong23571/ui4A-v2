import { Buffer } from 'node:buffer';

import type { SirenAction } from '@ui4a/engine';
import { afterAll, describe, expect, it } from 'vitest';

import { createLlmDriver } from './llm-driver';
import { buildLlmMessages } from './prompts';
import { createContractClient } from '../contract/http';
import {
  collectionEntity,
  createScriptedTransport,
  instanceEntity,
  type RecordedCall,
} from '../testkit/testkit';
import type { DriverContext, FetchLike, SitemapSummary } from '../types';

const DECIDE_WIRE_BUDGET_BYTES = 32 * 1024;
const textEncoder = new TextEncoder();

const TEST_LLM_CONFIG = {
  apiKey: 'test-key',
  baseURL: 'https://provider.test/v1',
  model: 'test-model',
} as const;

interface BudgetCase {
  name: string;
  app: string;
  rel: string;
  flow: string;
  action: SirenAction;
  goal: DriverContext['goal'];
}

interface BudgetMeasurement {
  name: string;
  messagesBytes: number;
  wireBytes: number;
}

const budgetCases: BudgetCase[] = [
  {
    name: 'business 文章阅读',
    app: 'publishing',
    rel: 'post:welcome',
    flow: 'post-status',
    action: action('archive', '归档文章'),
    goal: { verb: '阅读文章并概括正文', targetRel: 'post:welcome' },
  },
  {
    name: 'business 向导',
    app: 'editorial',
    rel: 'article-drafting:main',
    flow: 'article-drafting',
    action: action('next', '下一步'),
    goal: { verb: '继续填写文章向导', fields: { title: '操作流程' } },
  },
  {
    name: 'meta 定义治理',
    app: 'governance',
    rel: 'meta/draft:draft-1',
    flow: 'definition-governance',
    action: action('submit', '提交定义草案'),
    goal: { verb: '检查并提交定义草案', targetRel: 'meta/draft:draft-1' },
  },
];

const measurements: BudgetMeasurement[] = [];

const OLD_ARTICLE_BODY_MARKER = 'OLD_FULL_ARTICLE_BODY_MUST_NOT_REACH_PROVIDER';
const OLD_META_DEFINITION_MARKER = 'OLD_META_DEFINITION_MUST_NOT_REACH_PROVIDER';
const CURRENT_RAW_PAYLOAD_MARKER = 'CURRENT_RAW_PAYLOAD_MUST_NOT_REACH_PROVIDER';
const VISUAL_POLICY_MARKER = 'VISUAL_POLICY_MUST_NOT_REACH_PROVIDER';
const VERBOSE_TRAIL_MARKER = 'VERBOSE_TRAIL_RESULT_MUST_NOT_REACH_PROVIDER';

function action(name: string, title: string): SirenAction {
  return {
    name,
    title,
    method: 'POST',
    href: '/api/exec',
    fields: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { note: { type: 'string', title: '说明' } },
      required: ['note'],
      additionalProperties: false,
    },
  };
}

function utf8Bytes(value: unknown): number {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const encodedBytes = textEncoder.encode(serialized).byteLength;
  expect(encodedBytes).toBe(Buffer.byteLength(serialized, 'utf8'));
  return encodedBytes;
}

function schema(marker: string): Record<string, unknown> {
  return {
    type: 'object',
    description: marker.repeat(12_000),
    properties: {
      payload: { type: 'string', description: marker.repeat(12_000) },
    },
  };
}

function sitemapFor(testCase: BudgetCase): {
  sitemap: SitemapSummary;
  marker: string;
  foreignRel: string;
} {
  const marker = `FOREIGN_SCHEMA_${testCase.app.toUpperCase()}_MUST_NOT_REACH_PROMPT`;
  const foreignRel = `foreign-${testCase.app}-entry`;
  const foreignApps = [`foreign-${testCase.app}-one`, `foreign-${testCase.app}-two`];
  const applications: SitemapSummary['applications'] = [
    {
      name: testCase.app,
      intent: `处理 ${testCase.name}`,
      flows: [
        {
          name: testCase.flow,
          title: `${testCase.name}流程`,
          actions: [
            {
              name: testCase.action.name,
              title: testCase.action.title,
              node: 'active',
              guards: ['authorized'],
            },
          ],
        },
      ],
    },
    ...foreignApps.map((app, index) => ({
      name: app,
      intent: `foreign application ${index + 1}`,
      flows: [
        {
          name: `${app}-flow`,
          title: `Foreign flow ${index + 1}`,
          actions: [
            {
              name: `foreign-action-${index + 1}`,
              title: `Foreign action ${index + 1}`,
              node: 'foreign',
              guards: [],
            },
          ],
        },
      ],
    })),
  ];
  const sitemap: SitemapSummary = {
    version: `budget-${testCase.app}-v1`,
    surfaces: [
      { rel: `${testCase.app}-home`, title: `${testCase.name}入口`, app: testCase.app },
      { rel: foreignRel, title: 'Foreign entry one', app: foreignApps[0] },
      {
        rel: `foreign-${testCase.app}-second-entry`,
        title: 'Foreign entry two',
        app: foreignApps[1],
      },
    ],
    applications,
    capabilities: [
      {
        name: `${testCase.app}-capability`,
        title: `${testCase.name} capability`,
        kind: 'transform',
        intent: `辅助 ${testCase.name}`,
        input: 'navigate to capability input contract by rel',
        output: 'navigate to capability output contract by rel',
        inputSchema: schema(marker),
        outputSchema: schema(marker),
        scope: { applications: [testCase.app], flows: [testCase.flow] },
      },
      ...foreignApps.map((app, index) => ({
        name: `${app}-capability`,
        title: `Foreign capability ${index + 1}`,
        kind: 'effect' as const,
        intent: `foreign capability intent ${index + 1}`,
        input: `foreign capability ${index + 1} input rel`,
        output: `foreign capability ${index + 1} output rel`,
        inputSchema: schema(marker),
        outputSchema: schema(marker),
        scope: { applications: [app], flows: [`${app}-flow`] },
      })),
    ],
  };
  expect(utf8Bytes(sitemap)).toBeGreaterThan(DECIDE_WIRE_BUDGET_BYTES);
  return { sitemap, marker, foreignRel };
}

function contextFor(testCase: BudgetCase): {
  context: DriverContext;
  marker: string;
  foreignRel: string;
} {
  const { sitemap, marker, foreignRel } = sitemapFor(testCase);
  const entity = instanceEntity({
    rel: testCase.rel,
    flow: testCase.flow,
    node: 'active',
    title: testCase.name,
    fields: { body: `当前 ${testCase.name} 的授权事实` },
    actions: [testCase.action],
    collection: `${testCase.app}-home`,
    guardResults: [{ action: testCase.action.name, blocked: false }],
  });
  return {
    marker,
    foreignRel,
    context: {
      goal: testCase.goal,
      app: testCase.app,
      currentRel: testCase.rel,
      entity,
      trail: [],
      successes: [],
      sitemap,
    },
  };
}

function sseToolResponse(toolName: string, args: unknown): Response {
  const chunks = [
    {
      id: 'chatcmpl-budget',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_budget',
                type: 'function',
                function: { name: toolName, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-budget',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function requestBody(calls: RecordedCall[]): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toContain('/chat/completions');
  expect(calls[0]?.body).toBeDefined();
  return calls[0]!.body!;
}

function d54ObservationContext(): DriverContext {
  const articles = collectionEntity({
    rel: 'articles',
    members: [
      {
        rel: 'post:welcome',
        flow: 'post-status',
        node: 'published',
        title: '欢迎使用 UI4A',
        fields: {
          body: `${OLD_ARTICLE_BODY_MARKER}:${'旧文章正文。'.repeat(128)}`,
          author: '内容团队',
        },
      },
      {
        rel: 'post:contract-first',
        flow: 'post-status',
        node: 'published',
        title: '界面即合同',
        fields: { body: '人和 Agent 读取同一份授权事实。' },
      },
    ],
  });
  const metaFlow = {
    class: ['meta', 'flow-definition'],
    properties: {
      rel: 'meta/flow:article-drafting',
      name: 'article-drafting',
      title: '文章发布向导',
      status: 'active',
      version: 7,
      detail: {
        definition: `${OLD_META_DEFINITION_MARKER}:${'定义全文。'.repeat(128)}`,
        nodes: [{ name: 'basic-info' }, { name: 'content' }, { name: 'review' }],
      },
      presentation: {
        density: 'table',
        narrowDensity: 'card',
        sticky: true,
        marker: VISUAL_POLICY_MARKER,
      },
    },
    actions: [],
    links: [
      {
        rel: ['self'],
        href: '/_meta/api/entity?rel=meta%2Fflow%3Aarticle-drafting',
      },
    ],
    'guard-results': [],
  } as DriverContext['entity'];
  const moderate = action('approve', '通过评论');
  const comment = instanceEntity({
    rel: 'comment:pending-1',
    flow: 'comment-moderation',
    node: 'pending',
    title: '待审核评论',
    fields: {
      body: '这条评论包含 UTF-8 事实：你好，社区 👋',
      author: '访客甲',
      rawPayload: `${CURRENT_RAW_PAYLOAD_MARKER}:${'原始载荷。'.repeat(128)}`,
    },
    actions: [moderate],
    collection: 'comments',
    guardResults: [{ action: moderate.name, blocked: false }],
  });
  comment.properties.presentation = {
    fields: [
      {
        path: 'properties.fields.body',
        title: '评论正文',
        role: 'primary-content',
        overview: true,
      },
      {
        path: 'properties.fields.author',
        title: '评论者',
        role: 'metadata',
        overview: true,
      },
    ],
    density: 'decision-list',
    sticky: true,
    marker: VISUAL_POLICY_MARKER,
  };

  return {
    goal: { verb: '审核当前评论，并解释为什么可以通过', targetRel: 'comment:pending-1' },
    app: 'community',
    currentRel: 'comment:pending-1',
    entity: comment,
    observations: [
      { rel: 'articles', entity: articles },
      { rel: 'meta/flow:article-drafting', entity: metaFlow },
      { rel: 'comment:pending-1', entity: comment },
    ],
    trail: [
      {
        step: 1,
        rel: 'articles',
        op: {
          kind: 'answer',
          content: `${VERBOSE_TRAIL_MARKER}:${'历史回答。'.repeat(128)}`,
          sources: [{ rel: 'articles', pointer: '/entities/0/properties/fields/body' }],
          continue: true,
        },
        outcome: 'answered',
      },
      {
        step: 2,
        rel: 'comment:pending-1',
        op: { kind: 'navigate', rel: 'comment:pending-1' },
        outcome: 'navigated',
      },
    ],
    successes: [],
    conversationMessages: [
      { messageId: 'm-user-1', role: 'user', content: '请先看文章，再审核这条评论。' },
      { role: 'assistant', content: '我已转到当前评论。' },
      { messageId: 'm-user-2', role: 'user', content: '“这条”就是眼前这条，保留中文与 emoji 👋。' },
    ],
    conversation: {
      activeGoal: { verb: '审核当前评论', targetRel: 'comment:pending-1' },
      focus: {
        currentRel: 'comment:pending-1',
        history: [{ rel: 'articles' }, { rel: 'comment:pending-1', sourceMessageId: 'm-user-2' }],
      },
      referents: [{ text: '这条', rel: 'comment:pending-1', sourceMessageId: 'm-user-2' }],
      constraints: [{ text: '保留中文与 emoji 👋', sourceMessageId: 'm-user-2' }],
    },
    sitemap: {
      version: 'd54-real-shape-v1',
      surfaces: [
        { rel: 'articles', title: '文章', app: 'publishing' },
        {
          rel: 'comments',
          title: '评论审核',
          app: 'community',
          presentation: { density: 'decision-list', marker: VISUAL_POLICY_MARKER },
        } as unknown as SitemapSummary['surfaces'][number],
        { rel: 'meta/flows', title: 'Flow 定义', app: 'governance' },
      ],
      applications: [
        {
          name: 'community',
          intent: '审核社区评论',
          flows: [
            {
              name: 'comment-moderation',
              title: '评论审核',
              actions: [
                { name: 'approve', title: '通过评论', node: 'pending', guards: ['authorized'] },
              ],
            },
          ],
        },
      ],
      capabilities: [],
    },
  };
}

interface RawProviderCapture {
  rawBody: string;
  calls: number;
}

async function captureProviderRequest(context: DriverContext): Promise<RawProviderCapture> {
  let rawBody: string | undefined;
  let calls = 0;
  const fetchImpl: FetchLike = async (_url, init) => {
    calls += 1;
    if (typeof init?.body !== 'string') throw new Error('provider request body must be a string');
    rawBody = init.body;
    return sseToolResponse('answer', {
      content: '预算边界请求已读取。',
      sources: [{ rel: context.currentRel, pointer: '/properties/fields/body' }],
    });
  };
  const driver = createLlmDriver({ ...TEST_LLM_CONFIG, fetchImpl });
  await expect(driver.decide(context)).resolves.toMatchObject({ kind: 'answer' });
  expect(calls).toBe(1);
  expect(rawBody).toBeDefined();
  return { rawBody: rawBody!, calls };
}

function boundaryContext(toolPadding: number, goalPadding: number): DriverContext {
  const boundaryAction: SirenAction = {
    ...action('approve', '通过评论'),
    fields: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        note: {
          type: 'string',
          title: '审核说明',
          description: 't'.repeat(toolPadding),
        },
      },
      required: ['note'],
      additionalProperties: false,
    },
  };
  return {
    goal: {
      verb: '审核 UTF-8 评论 👋',
      targetRel: 'comment:budget-boundary',
      resource: 'g'.repeat(goalPadding),
    },
    app: 'community',
    currentRel: 'comment:budget-boundary',
    entity: instanceEntity({
      rel: 'comment:budget-boundary',
      flow: 'comment-moderation',
      node: 'pending',
      title: '预算边界评论',
      fields: { body: '你好，预算边界 👋' },
      actions: [boundaryAction],
      collection: 'comments',
      guardResults: [{ action: 'approve', blocked: false }],
    }),
    observations: [],
    trail: [
      {
        step: 1,
        rel: 'comments',
        op: { kind: 'navigate', rel: 'comment:budget-boundary' },
        outcome: 'navigated',
      },
    ],
    successes: [],
    conversationMessages: [
      { messageId: 'm-budget', role: 'user', content: '审核这条 UTF-8 评论 👋' },
    ],
    conversation: {
      activeGoal: { verb: '审核评论', targetRel: 'comment:budget-boundary' },
      focus: { currentRel: 'comment:budget-boundary', history: [{ rel: 'comments' }] },
    },
    sitemap: {
      version: 'budget-boundary-v1',
      surfaces: [{ rel: 'comments', title: '评论审核', app: 'community' }],
      applications: [
        {
          name: 'community',
          intent: '审核社区评论',
          flows: [{ name: 'comment-moderation', title: '评论审核', actions: [] }],
        },
      ],
      capabilities: [],
    },
  };
}

async function exactBoundaryFixture(): Promise<{
  context: DriverContext;
  toolPadding: number;
  goalPadding: number;
}> {
  const baseline = await captureProviderRequest(boundaryContext(0, 0));
  const baselineBytes = utf8Bytes(baseline.rawBody);
  expect(baselineBytes).toBeLessThan(DECIDE_WIRE_BUDGET_BYTES);

  const oneToolByte = await captureProviderRequest(boundaryContext(1, 0));
  const toolCoefficient = utf8Bytes(oneToolByte.rawBody) - baselineBytes;
  expect(toolCoefficient).toBeGreaterThan(0);
  const toolPadding = Math.floor((DECIDE_WIRE_BUDGET_BYTES - baselineBytes) / toolCoefficient);
  const toolFilled = await captureProviderRequest(boundaryContext(toolPadding, 0));
  const remaining = DECIDE_WIRE_BUDGET_BYTES - utf8Bytes(toolFilled.rawBody);
  expect(remaining).toBeGreaterThanOrEqual(0);

  const context = boundaryContext(toolPadding, remaining);
  const exact = await captureProviderRequest(context);
  expect(utf8Bytes(exact.rawBody)).toBe(DECIDE_WIRE_BUDGET_BYTES);
  return { context, toolPadding, goalPadding: remaining };
}

describe('32 KiB decide prompt wire budget', () => {
  it.each(budgetCases)('$name: messages stay bounded without capability schemas', (testCase) => {
    const { context, marker, foreignRel } = contextFor(testCase);
    const serialized = JSON.stringify(buildLlmMessages(context));
    const messagesBytes = utf8Bytes(serialized);

    expect(messagesBytes).toBeLessThanOrEqual(DECIDE_WIRE_BUDGET_BYTES);
    expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain('inputSchema');
    expect(serialized).not.toContain('outputSchema');
    expect(serialized).toContain(testCase.action.name);
    expect(serialized).toContain(foreignRel);
  });

  it.each(budgetCases)(
    '$name: real driver request including tools stays within budget',
    async (testCase) => {
      const { context, marker, foreignRel } = contextFor(testCase);
      const transport = createScriptedTransport(() =>
        sseToolResponse('answer', {
          content: '已读取当前授权事实。',
          sources: [{ rel: testCase.rel, pointer: '/properties/fields/body' }],
        }),
      );
      const driver = createLlmDriver({ ...TEST_LLM_CONFIG, fetchImpl: transport.fetch });

      await expect(driver.decide(context)).resolves.toEqual({
        kind: 'answer',
        content: '已读取当前授权事实。',
        sources: [{ rel: testCase.rel, pointer: '/properties/fields/body' }],
      });

      const body = requestBody(transport.calls);
      const serialized = JSON.stringify(body);
      const wireBytes = utf8Bytes(serialized);
      const messagesBytes = utf8Bytes(buildLlmMessages(context));
      measurements.push({ name: testCase.name, messagesBytes, wireBytes });

      expect(wireBytes).toBeLessThanOrEqual(DECIDE_WIRE_BUDGET_BYTES);
      expect(serialized).not.toContain(marker);
      expect(serialized).not.toContain('FOREIGN_SCHEMA_');
      expect(serialized).toContain(`action_${testCase.action.name}`);
      expect(serialized).toContain(foreignRel);
    },
  );
});

describe('D54 current sanitized observation and non-cumulative disclosure', () => {
  it('rebuilds each Assistant decision from only the current sanitized entity and structural trail', () => {
    const context = d54ObservationContext();
    const serialized = JSON.stringify(buildLlmMessages(context));

    expect(serialized).toContain('comment:pending-1');
    expect(serialized).toContain('这条评论包含 UTF-8 事实：你好，社区 👋');
    expect(serialized).toContain('通过评论');
    expect(serialized).toContain('“这条”就是眼前这条，保留中文与 emoji 👋。');
    expect(serialized).not.toContain(OLD_ARTICLE_BODY_MARKER);
    expect(serialized).not.toContain(OLD_META_DEFINITION_MARKER);
    expect(serialized).not.toContain(CURRENT_RAW_PAYLOAD_MARKER);
    expect(serialized).not.toContain(VERBOSE_TRAIL_MARKER);
    expect(serialized).not.toContain(VISUAL_POLICY_MARKER);
  });

  it('keeps the public HTTP Siren entity complete while only provider disclosure is sanitized', async () => {
    const context = d54ObservationContext();
    const observations = context.observations!;
    const client = createContractClient('https://ui4a.test', async (url) => {
      const rel = new URL(url).searchParams.get('rel');
      const observation = observations.find((entry) => entry.rel === rel);
      return observation === undefined
        ? Response.json({ error: 'not found' }, { status: 404 })
        : Response.json(observation.entity);
    });

    const responses = await Promise.all(observations.map(({ rel }) => client.getEntity(rel)));

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(responses.map(({ entity }) => entity)).toEqual(observations.map(({ entity }) => entity));
    const publicContract = JSON.stringify(responses);
    expect(publicContract).toContain(OLD_ARTICLE_BODY_MARKER);
    expect(publicContract).toContain(OLD_META_DEFINITION_MARKER);
    expect(publicContract).toContain(CURRENT_RAW_PAYLOAD_MARKER);
    expect(publicContract).toContain(VISUAL_POLICY_MARKER);
  });

  it('projects a large current collection as bounded member summaries without narrowing HTTP', async () => {
    const rawMarker = 'LARGE_COLLECTION_FULL_BODY_MUST_NOT_REACH_PROVIDER';
    const collection = collectionEntity({
      rel: 'articles',
      members: Array.from({ length: 120 }, (_, index) => ({
        rel: `post:large-${index}`,
        flow: 'post-status',
        node: 'published',
        title: `文章 ${index}`,
        fields: {
          title: `文章 ${index}`,
          category: index % 2 === 0 ? 'tech' : 'essay',
          body: `${rawMarker}:${'完整正文。'.repeat(128)}`,
        },
        actions: [action('archive', '归档文章')],
        guardResults: [{ action: 'archive', blocked: index === 0, reason: '需要确认归档范围' }],
      })),
    });
    for (const member of collection.entities ?? []) {
      member.properties.presentation = {
        fields: [
          {
            path: 'properties.fields.title',
            title: '标题',
            role: 'identity',
            overview: true,
          },
          {
            path: 'properties.fields.category',
            title: '分类',
            role: 'metadata',
            overview: true,
          },
          {
            path: 'properties.fields.body',
            title: '正文',
            role: 'primary-content',
          },
        ],
      };
    }
    const context: DriverContext = {
      goal: { verb: '浏览文章目录', targetRel: 'articles' },
      app: 'publishing',
      currentRel: 'articles',
      entity: collection,
      observations: [{ rel: 'articles', entity: collection }],
      trail: [],
      successes: [],
      sitemap: {
        version: 'large-collection-v1',
        surfaces: [{ rel: 'articles', title: '文章目录', app: 'publishing' }],
        applications: [
          {
            name: 'publishing',
            intent: '管理文章',
            flows: [{ name: 'post-status', title: '文章生命周期', actions: [] }],
          },
        ],
        capabilities: [],
      },
    };

    const captured = await captureProviderRequest(context);
    const messages = JSON.stringify(buildLlmMessages(context));
    expect(utf8Bytes(captured.rawBody)).toBeLessThanOrEqual(DECIDE_WIRE_BUDGET_BYTES);
    expect(messages).toContain('post:large-0');
    expect(messages).toContain('post:large-7');
    expect(messages).not.toContain('post:large-8');
    expect(captured.rawBody).not.toContain(rawMarker);
    expect(captured.rawBody).toContain('需要确认归档范围');

    const client = createContractClient('https://ui4a.test', async () => Response.json(collection));
    const response = await client.getEntity('articles');
    const publicEntity = response.entity;
    if (publicEntity === undefined) throw new Error('expected public collection entity');
    expect(publicEntity).toEqual(collection);
    expect(JSON.stringify(publicEntity)).toContain(rawMarker);
    expect(publicEntity.entities).toHaveLength(120);
  });
});

describe('D54 final provider request UTF-8 runtime guard', () => {
  it('allows exactly 32,768 bytes and rejects 32,769 bytes before a fresh provider fetch', async () => {
    const exact = await exactBoundaryFixture();
    const accepted = await captureProviderRequest(exact.context);
    expect(utf8Bytes(accepted.rawBody)).toBe(DECIDE_WIRE_BUDGET_BYTES);

    const overBudgetContext = boundaryContext(exact.toolPadding, exact.goalPadding + 1);
    expect(
      utf8Bytes(buildLlmMessages(overBudgetContext)) - utf8Bytes(buildLlmMessages(exact.context)),
    ).toBe(1);

    const guardedTransport = createScriptedTransport(() =>
      sseToolResponse('answer', {
        content: '超限请求不应到达 provider。',
        sources: [{ rel: overBudgetContext.currentRel, pointer: '/properties/fields/body' }],
      }),
    );
    const guardedDriver = createLlmDriver({
      ...TEST_LLM_CONFIG,
      fetchImpl: guardedTransport.fetch,
    });

    await expect(guardedDriver.decide(overBudgetContext)).resolves.toMatchObject({
      kind: 'fail',
      reason: expect.stringMatching(/UTF-8.*32,769.*32,768|32,769.*32,768.*UTF-8/),
    });
    expect(guardedTransport.calls).toHaveLength(0);
  });
});

afterAll(() => {
  process.stdout.write(`prompt budget bytes ${JSON.stringify(measurements)}\n`);
});
