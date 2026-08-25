/**
 * T2 Phase E / Task E4 — 真实 LLM 冒烟(RUN_LLM_E2E + provider profile 门控,默认 skip)。
 *
 * goal B1 不传 fields:三步向导内容(标题/分类/正文)全部由 LLM 按字段语义
 * 自行编写(枚举字段必须落在 enum 内)。provider endpoint/model 均由环境显式提供:
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

test('真实 LLM:B1 目标让 LLM 自编三步内容并发布(文章 2→3)', async () => {
  await withFreshServer(async () => {
    const before = (await (await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`)).json()) as {
      properties: { count: number };
    };
    expect(before.properties.count).toBe(2);

    const response = await fetch(`${SCENARIO_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'llm-smoke',
        goal: { verb: '发布一篇文章' }, // 不传 fields:内容由 LLM 自编
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

    // 三步填充(next×3,分类落在 enum 内)+ publish 成功
    expect(trajectory.match(/执行 next/g)).toHaveLength(3);
    expect(trajectory).toContain('执行 publish');
    expect(trajectory).toMatch(/"category":"(tech|essay|review)"/);

    // 文章真实落库
    const after = (await (await fetch(`${SCENARIO_BASE}/api/entity?rel=articles`)).json()) as {
      properties: { count: number };
      entities: { properties: { rel: string; node: string } }[];
    };
    expect(after.properties.count).toBe(3);
    expect(after.entities.map((sub) => sub.properties.node)).toEqual([
      'published',
      'published',
      'published',
    ]);
  });
});
