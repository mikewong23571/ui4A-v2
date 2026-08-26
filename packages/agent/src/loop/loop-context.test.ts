/**
 * agent 循环协议单测(T2 Phase D / Task D1)之场景分片(自 loop.test.ts 按 describe 拆分,
 * 行为不变):共享夹具见 ./loop-test-fixtures。
 */
import { describe, expect, it } from 'vitest';

import {
  BASE,
  GOAL,
  articlesEntity,
  ScriptedDriver,
  contractTransport,
} from './loop-test-fixtures';
import { runAgent } from './loop';
import { instanceEntity } from '../testkit/testkit';

const groupedSitemapBody = {
  version: 'v-apps',
  surfaces: [
    { rel: 'articles', title: '文章集合', app: 'publishing' },
    { rel: 'comments', title: '评论队列', app: 'community' },
  ],
  flows: [
    { name: 'article-drafting', title: '文章发布向导', app: 'publishing' },
    { name: 'comment-moderation', title: '评论审核', app: 'community' },
  ],
  applications: [
    {
      name: 'publishing',
      title: '发布',
      intent: '内容起草与发布',
      flows: [{ name: 'article-drafting', title: '文章发布向导', app: 'publishing' }],
    },
    {
      name: 'community',
      title: '社区',
      intent: '评论审核与社区互动',
      flows: [{ name: 'comment-moderation', title: '评论审核', app: 'community' }],
    },
  ],
  capabilities: [
    {
      name: 'draft',
      title: '工件起草',
      kind: 'extract',
      intent: '生成文章候选草稿',
      input: '文章字段 schema',
      output: '候选草稿',
      inputSchema: { type: 'object', required: ['body'] },
      outputSchema: { type: 'object', required: ['summary'] },
      scope: { applications: ['publishing'], flows: ['article-drafting'] },
    },
    {
      name: 'moderate',
      title: '评论审核建议',
      kind: 'transform',
      intent: '识别评论风险',
      scope: { applications: ['community'], flows: ['comment-moderation'] },
    },
  ],
};

describe('静态上下文:sitemap 按 app 分组呈现(T10 Phase D)', () => {
  it('从实体 flow 推导 scope，保留当前 app 全形并把其他 app 降为导航入口', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity },
      sitemap: groupedSitemapBody,
    });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    const sitemap = driver.contexts[0]!.sitemap;
    expect(sitemap?.version).toBe('v-apps');
    expect(sitemap?.applications.map((app) => app.name)).toEqual(['publishing']);
    const publishing = sitemap?.applications.find((app) => app.name === 'publishing');
    expect(publishing?.intent).toBe('内容起草与发布');
    expect(publishing?.flows).toEqual([
      { name: 'article-drafting', title: '文章发布向导', actions: [] },
    ]);
    expect(sitemap?.surfaces).toEqual([
      { rel: 'articles', title: '文章集合', app: 'publishing' },
      { rel: 'comments', title: '评论队列' },
    ]);
  });

  it('旧形状 sitemap(无 applications 字段)→ 分组为空数组,扁平 surfaces 照常', async () => {
    const transport = contractTransport({
      entities: { articles: articlesEntity },
      sitemap: { version: 'v-flat', surfaces: [{ rel: 'articles', title: '文章集合' }] },
    });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    const sitemap = driver.contexts[0]!.sitemap;
    expect(sitemap?.version).toBe('v-flat');
    expect(sitemap?.applications).toEqual([]);
    expect(sitemap?.capabilities).toEqual([]);
    expect(sitemap?.surfaces).toEqual([{ rel: 'articles', title: '文章集合' }]);
  });

  it('指定 app 后只向 driver 披露该 app 的 surfaces/flows/actions/capabilities', async () => {
    const sitemap = structuredClone(groupedSitemapBody);
    (
      sitemap.applications[0]!.flows[0] as unknown as {
        nodes: { name: string; actions: unknown[] }[];
      }
    ).nodes = [
      {
        name: 'published',
        actions: [{ name: 'feature', title: '新激活动作', guards: [] }],
      },
    ];
    const transport = contractTransport({
      entities: { articles: articlesEntity },
      sitemap,
    });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      app: 'publishing',
    });

    expect(driver.contexts[0]!.sitemap).toMatchObject({
      surfaces: [
        { rel: 'articles', title: '文章集合', app: 'publishing' },
        { rel: 'comments', title: '评论队列' },
      ],
      applications: [
        {
          name: 'publishing',
          flows: [
            {
              name: 'article-drafting',
              actions: [{ name: 'feature', title: '新激活动作', node: 'published', guards: [] }],
            },
          ],
        },
      ],
      capabilities: [
        {
          name: 'draft',
          title: '工件起草',
          kind: 'extract',
          scope: { applications: ['publishing'], flows: ['article-drafting'] },
        },
      ],
    });
    expect(JSON.stringify(driver.contexts[0]!.sitemap)).not.toContain('inputSchema');
    expect(JSON.stringify(driver.contexts[0]!.sitemap)).not.toContain('outputSchema');
    expect(driver.contexts[0]!.sitemap?.capabilities).not.toContainEqual(
      expect.objectContaining({ name: 'moderate' }),
    );
  });

  it('未显式指定 app 时，从当前实体 flow 推导 app 并按 capability scope 有界披露', async () => {
    const drafting = instanceEntity({
      rel: 'article-drafting:main',
      flow: 'article-drafting',
      node: 'basic-info',
    });
    const transport = contractTransport({
      entities: { 'article-drafting:main': drafting },
      sitemap: groupedSitemapBody,
    });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      startRel: 'article-drafting:main',
    });

    expect(driver.contexts[0]!.app).toBe('publishing');
    expect(driver.contexts[0]!.sitemap?.applications.map((app) => app.name)).toEqual([
      'publishing',
    ]);
    expect(driver.contexts[0]!.sitemap?.capabilities?.map((capability) => capability.name)).toEqual(
      ['draft'],
    );
  });

  it('集合成员只落在一个 app 时，从嵌入 flow 推导 app 并披露该 app flow capabilities', async () => {
    const sitemap = {
      ...structuredClone(groupedSitemapBody),
      applications: groupedSitemapBody.applications.map((application) =>
        application.name === 'publishing'
          ? {
              ...application,
              flows: [
                ...application.flows,
                { name: 'post-status', title: '文章状态', app: 'publishing' },
              ],
            }
          : application,
      ),
      capabilities: [
        ...groupedSitemapBody.capabilities,
        {
          name: 'summarize',
          title: '正式摘要',
          kind: 'transform',
          intent: '生成正式文章摘要',
          scope: { applications: ['publishing'], flows: ['post-status'] },
        },
      ],
    };
    const transport = contractTransport({ entities: { articles: articlesEntity }, sitemap });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    expect(driver.contexts[0]!.app).toBe('publishing');
    expect(driver.contexts[0]!.sitemap?.applications.map((app) => app.name)).toEqual([
      'publishing',
    ]);
    expect(driver.contexts[0]!.sitemap?.capabilities?.map((capability) => capability.name)).toEqual(
      ['draft', 'summarize'],
    );
  });
});

describe('role/app 上下文槽位:数据注入路径(T10 Phase D)', () => {
  it('RunAgentOptions 提供 role/app/chatMarkdown → 每步 DriverContext 原样携带', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      role: '内容审核员',
      app: 'community',
      chatMarkdown: true,
    });

    expect(driver.contexts[0]!.role).toBe('内容审核员');
    expect(driver.contexts[0]!.app).toBe('community');
    expect(driver.contexts[0]!.chatMarkdown).toBe(true);
  });

  it('空槽(未提供)→ DriverContext 的 role/app 缺席(零行为变化)', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);

    await runAgent(driver, GOAL, { baseUrl: BASE, fetchImpl: transport.fetch });

    expect(driver.contexts[0]!.role).toBeUndefined();
    expect(driver.contexts[0]!.app).toBeUndefined();
    expect(driver.contexts[0]!.chatMarkdown).toBeUndefined();
  });
});

describe('有界多轮会话与结构化处境', () => {
  it('RunAgentOptions 只把最近 N 条原文按 role 传入每步，不改写输入', async () => {
    const transport = contractTransport({ entities: { articles: articlesEntity } });
    const driver = new ScriptedDriver([{ kind: 'done', summary: 'ok' }]);
    const messages = [
      { role: 'user' as const, content: '看看第一篇' },
      { role: 'assistant' as const, content: '已定位第一篇' },
      { role: 'user' as const, content: '总结一下' },
    ];
    const snapshot = structuredClone(messages);

    await runAgent(driver, GOAL, {
      baseUrl: BASE,
      fetchImpl: transport.fetch,
      conversationMessages: messages,
      maxConversationMessages: 2,
      conversation: {
        activeGoal: { verb: '总结第一篇', targetRel: 'post:first-post' },
        focus: {
          currentRel: 'post:first-post',
          history: [{ rel: 'articles' }, { rel: 'post:first-post', sourceMessageId: 'm1' }],
        },
        referents: [{ text: '它', rel: 'post:first-post', sourceMessageId: 'm3' }],
        constraints: [{ text: '不保存', sourceMessageId: 'm3' }],
      },
    });

    expect(driver.contexts[0]?.conversationMessages).toEqual(messages.slice(-2));
    expect(driver.contexts[0]?.conversation).toEqual({
      activeGoal: { verb: '总结第一篇', targetRel: 'post:first-post' },
      focus: {
        currentRel: 'post:first-post',
        history: [{ rel: 'articles' }, { rel: 'post:first-post', sourceMessageId: 'm1' }],
      },
      referents: [{ text: '它', rel: 'post:first-post', sourceMessageId: 'm3' }],
      constraints: [{ text: '不保存', sourceMessageId: 'm3' }],
    });
    expect(messages).toEqual(snapshot);
  });
});
