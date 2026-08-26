/**
 * T2 Phase E / Task E4 — 真实 LLM 冒烟(RUN_LLM_E2E + provider profile 门控,默认 skip)。
 *
 * goal B1 用自然语言明确授权标题/分类/正文，LLM 仍须自主读取合同并选择动作。
 * provider endpoint/model 均由环境显式提供:
 *
 * ```bash
 * LLM_API_KEY=... LLM_BASE_URL=https://provider.example/v1 LLM_MODEL=provider-model \
 *   RUN_LLM_E2E=1 \
 *   CI=true pnpm exec playwright test e2e/llm-smoke.spec.ts
 * ```
 *
 * 逐步决策为真实网络往返(约 8-20s/步),超时给足;断言失败时如实上报轨迹。
 */
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

test.skip(
  !process.env.RUN_LLM_E2E ||
    !process.env.LLM_API_KEY ||
    !process.env.LLM_BASE_URL ||
    !process.env.LLM_MODEL,
  'RUN_LLM_E2E 或 LLM provider profile 未完整设置(真实 LLM 冒烟,默认 skip)',
);

test.beforeEach(() => {
  test.setTimeout(420_000);
});

const REQUEST =
  '新增一篇文章，标题为《LLM 冒烟文章》，分类为 tech，正文为“这是一篇验证真实 LLM 合同写入的文章。”';

interface ArticleCollection {
  properties: { count: number };
  entities: { properties: { rel: string; node: string } }[];
}

async function articleCollection(): Promise<ArticleCollection> {
  return (await (
    await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`)
  ).json()) as ArticleCollection;
}

async function article(rel: string): Promise<{ properties: { fields: Record<string, unknown> } }> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<{ properties: { fields: Record<string, unknown> } }>;
}

test('真实 LLM:B1 明确自然语言写请求经合同完成且仅新增授权文章', async () => {
  await withFreshServer(async () => {
    const before = await articleCollection();
    expect(before.properties.count).toBe(2);
    const existingRels = before.entities.map((entity) => entity.properties.rel);
    const existingBefore = await Promise.all(existingRels.map(article));

    const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'llm-smoke',
        goal: { verb: REQUEST },
        driver: 'llm',
      }),
    });
    expect(response.status).toBe(200);
    // T9 Phase B:inline 响应为 SSE 流(step 帧 + final 终帧);final payload
    // 即回合结果,messages 由各 step 帧文本聚回(与旧一次性 JSON 同口径)。
    const raw = await response.text();
    const frames = raw
      .split('\n\n')
      .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
      .filter((line): line is string => line !== undefined)
      .map(
        (line) =>
          JSON.parse(line.slice('data:'.length).trim()) as {
            type: string;
            message?: { text: string };
            payload?: { driver?: string; outcome?: string; summary?: string | null };
          },
      );
    const finalPayload = frames.find((frame) => frame.type === 'final')?.payload ?? {};
    const body = {
      driver: finalPayload.driver,
      outcome: finalPayload.outcome,
      summary: finalPayload.summary ?? null,
      messages: frames.flatMap((frame) =>
        frame.type === 'step' && frame.message !== undefined ? [frame.message] : [],
      ),
    };

    expect(body.driver).toBe('llm');
    const trajectory = body.messages.map((message) => message.text).join('\n');
    // 失败也如实断言输出,便于冒烟报告定位(断言放最后,先收集信息)
    if (body.outcome !== 'done') {
      console.log('LLM 冒烟未完成:', body.outcome, body.summary);
      console.log(trajectory);
    }
    expect(body.outcome, `轨迹:\n${trajectory}\nsummary: ${body.summary}`).toBe('done');

    // 业务结果与安全边界来自实体投影，不绑定模型采取的完整工具轨迹。
    const after = await articleCollection();
    expect(after.properties.count).toBe(3);
    expect(after.entities.every((entity) => entity.properties.node === 'published')).toBe(true);
    const createdRels = after.entities
      .map((entity) => entity.properties.rel)
      .filter((rel) => !existingRels.includes(rel));
    expect(createdRels).toHaveLength(1);
    expect(createdRels[0]).not.toMatch(/^(?:meta\/|draft:)/);
    const created = await article(createdRels[0]!);
    expect(created.properties.fields).toMatchObject({
      title: 'LLM 冒烟文章',
      category: 'tech',
      body: '这是一篇验证真实 LLM 合同写入的文章。',
    });
    expect(await Promise.all(existingRels.map(article))).toEqual(existingBefore);
  });
});
