/**
 * T11 Phase D — 真实 LLM 门控:思考流与留痕(RUN_LLM_E2E + provider profile 门控,默认 skip)。
 *
 * spec 验收 4/5 的门控实测部分(provider profile 由环境提供):
 * 1. thinking 帧:llm 回合 SSE 流 ≥1 条 {type:'thinking', step, text},text 非空,
 *    且先于同号 step 帧(step 帧不带步号字段,"同号" = 第 N 条 step 帧——route.ts
 *    以已发 step 帧计数 + 1 给 thinking 编步);
 * 2. reasoning 落库:/api/events 的 agent-decision 每步一条、detail 五要素
 *    (step/driver/prompt/reasoning/op)齐全；provider 可只在部分步骤返回 reasoning，
 *    但每条真实 thinking 必须与同号 decision 的非空 reasoning 同源;
 * 3. chat-turn detail 含结构化 steps(TrailStep[] 原料,架构决定 2);
 * 4. 思考区可见(UI):回合经聊天面板真实发起,「思考 · 步骤 N」折叠区逐步出现
 *    (默认收起,展开读全文)。同一回合的 SSE 原文经 waitForResponse 取回做帧级
 *    断言——UI 渲染与帧内容同回合互证,免去第二回合(UI 驱动并非分钟级:
 *    三步回合与 API 直发同价)。
 *
 * 目标设计:「下线 post-welcome」= navigate → unpublish → done 三步回合
 * (unpublish 零参数,guard is-published 对种子 post:post-welcome 恒真)——
 * 比 llm-smoke 的六步发布向导更短的完成型 llm 回合;D22 简单步 4–9s,
 * 全程含 server 冷启动约两分钟,超时给足(llm-smoke 同口径)。
 *
 * ```bash
 * LLM_API_KEY=... LLM_BASE_URL=... LLM_MODEL=... RUN_LLM_E2E=1 \
 *   CI=true pnpm exec playwright test e2e/llm-thinking.spec.ts
 * ```
 *
 * 观测(步数/thinking 帧数/reasoning 字符量/时延)打印到 stdout;不含任何凭证。
 */
import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from '../kits/server-kit';

test.skip(
  !process.env.RUN_LLM_E2E ||
    !process.env.LLM_API_KEY ||
    !process.env.LLM_BASE_URL ||
    !process.env.LLM_MODEL,
  'RUN_LLM_E2E 或 LLM provider profile 未完整设置(真实 LLM 思考流门控,默认 skip)',
);

// UI 与 API 同打场景 server(3110):同一回合、同一事件日志。
test.use({ baseURL: SCENARIO_BASE });

test.beforeEach(() => {
  test.setTimeout(420_000);
});

/** SSE 帧(chat.spec.ts 同形;thinking 帧为 T11 Phase C 新增)。 */
interface SseFrame {
  type: 'step' | 'final' | 'error' | 'thinking';
  step?: number;
  text?: string;
  message?: { role: 'assistant'; text: string };
  payload?: {
    sessionId?: string;
    driver?: string;
    outcome?: string;
    summary?: string | null;
  };
}

/** 解析 SSE 帧流(`data: <json>` 空行分隔;与 chat.spec.ts 同口径)。 */
function parseSseFrames(raw: string): SseFrame[] {
  return raw
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((line) => line.startsWith('data:')))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice('data:'.length).trim()) as SseFrame);
}

/** /api/events 读回行(本 spec 只消费这些字段)。 */
interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  detail: unknown;
}

/** agent-decision detail(chat/decisions.ts 的 AgentDecisionDetail 镜像)。 */
interface AgentDecisionDetail {
  step: number;
  driver: 'llm';
  prompt: { system: string; user: string };
  reasoning: string | null;
  op: { kind: string };
}

/** chat-turn detail(chat/history.ts 的 ChatTurnDetail 消费面子集)。 */
interface ChatTurnDetail {
  driver: 'llm';
  outcome: string;
  steps: { step: number; rel: string; op: { kind: string }; outcome: string }[];
}

async function getEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { events: LoggedEvent[] }).events;
}

test('真实 GLM:thinking 帧先于同号 step 帧,reasoning 逐步落库,思考区折叠可见', async ({ page }) => {
  await withFreshServer(async () => {
    // ---- 经聊天面板发起真实 llm 回合(auto 在有 key 环境解析为 llm)----------
    await page.goto('/');
    await page.getByRole('button', { name: '展开聊天窗' }).click();
    await expect(page.getByPlaceholder('输入目标…')).toBeVisible();

    // 先挂响应捕获再发送:同一回合的 SSE 原文用于帧级断言(UI 同时自行消费渲染)。
    const chatResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/api/chat'),
    );
    const startedAt = Date.now();
    await page.getByPlaceholder('输入目标…').fill('下线 post-welcome');
    await page.getByRole('button', { name: '发送' }).click();

    const chatResponse = await chatResponsePromise;
    expect(chatResponse.status()).toBe(200);
    const raw = await chatResponse.text();
    const elapsedMs = Date.now() - startedAt;

    const frames = parseSseFrames(raw);
    const stepFrames = frames.filter((frame) => frame.type === 'step');
    const thinkingFrames = frames.filter((frame) => frame.type === 'thinking');
    const finalFrame = frames.find((frame) => frame.type === 'final');
    expect(finalFrame, 'SSE 流须含 final 终帧').toBeDefined();
    expect(frames[frames.length - 1]?.type, 'final 必须是末帧').toBe('final');

    const payload = finalFrame?.payload ?? {};
    expect(payload.driver, '有 key 环境 auto 必须解析为 llm').toBe('llm');
    const trajectory = stepFrames.map((frame) => frame.message?.text ?? '').join('\n');
    expect(payload.outcome, `轨迹:\n${trajectory}\nsummary: ${payload.summary ?? ''}`).toBe('done');
    const sessionId = payload.sessionId ?? '';
    expect(sessionId, 'final 帧须携带 sessionId(事件 rel 过滤键)').not.toBe('');

    // ---- 1. thinking 帧:至少一条、text 非空、先于同号 step 帧 ---------------
    expect(thinkingFrames.length, '真实 LLM 回合须至少产一条 thinking 帧').toBeGreaterThan(0);
    for (const frame of thinkingFrames) {
      const stepNumber = frame.step ?? 0;
      expect(stepNumber, 'thinking 帧须带正整数步号').toBeGreaterThanOrEqual(1);
      expect((frame.text ?? '').length, `thinking 帧(步 ${stepNumber})text 非空`).toBeGreaterThan(
        0,
      );
      const sameNumberedStepFrame = stepFrames[stepNumber - 1];
      expect(sameNumberedStepFrame, `thinking 帧(步 ${stepNumber})应有同号 step 帧`).toBeDefined();
      expect(
        frames.indexOf(frame),
        `thinking 帧(步 ${stepNumber})必须先于同号 step 帧`,
      ).toBeLessThan(frames.indexOf(sameNumberedStepFrame!));
    }

    // ---- 2. agent-decision 落库:每步一条、五要素齐全 -------------------------
    const events = await getEvents();
    const decisions = events.filter(
      (event) => event.kind === 'agent-decision' && event.rel === `chat:${sessionId}`,
    );
    expect(decisions, '每个 decide 恰落一条 agent-decision').toHaveLength(stepFrames.length);
    const details = decisions.map((event) => event.detail as AgentDecisionDetail);
    for (const [index, detail] of details.entries()) {
      expect(Object.keys(detail).sort(), 'detail 五要素齐全').toEqual([
        'driver',
        'op',
        'prompt',
        'reasoning',
        'step',
      ]);
      expect(detail.step, '决策步号自 1 递增').toBe(index + 1);
      expect(detail.driver).toBe('llm');
      expect(detail.prompt.system, 'llm prompt 存 system 全量原文').not.toBe('');
      expect(detail.prompt.user, 'llm prompt 存 user 全量原文(含目标)').toContain('下线');
      expect(detail.op.kind, '决策须携带 op').toBeTruthy();
    }
    // 每条实际出现的思考流与同号审计留痕同源；未返回 reasoning 的步骤合法为空。
    for (const frame of thinkingFrames) {
      const detail = details.find((candidate) => candidate.step === frame.step);
      expect(detail, `thinking 步 ${frame.step ?? 0} 须有同号 agent-decision`).toBeDefined();
      expect(detail?.reasoning, `thinking 步 ${frame.step ?? 0} 与审计 reasoning 同源`).toBe(
        frame.text,
      );
    }

    // ---- 3. chat-turn detail 含结构化 steps ---------------------------------
    const turns = events.filter(
      (event) => event.kind === 'chat-turn' && event.rel === `chat:${sessionId}`,
    );
    expect(turns, 'inline 回合恰落一条 chat-turn').toHaveLength(1);
    expect(turns[0]!.seq, 'agent-decision 先于 chat-turn 落库').toBeGreaterThan(
      decisions[decisions.length - 1]!.seq,
    );
    const turn = turns[0]!.detail as ChatTurnDetail;
    expect(turn.driver).toBe('llm');
    expect(turn.outcome).toBe('done');
    expect(Array.isArray(turn.steps), 'chat-turn detail.steps 为结构化数组').toBe(true);
    expect(turn.steps, '结构化 steps 与决策步一一对应').toHaveLength(details.length);
    for (const [index, step] of turn.steps.entries()) {
      expect(step.step).toBe(index + 1);
      expect(step.rel, 'step 须携带实体 rel').toBeTruthy();
      expect(step.op.kind, 'step 须携带操作').toBeTruthy();
      expect(step.outcome, 'step 须携带结果').toBeTruthy();
    }
    expect(turn.steps[turn.steps.length - 1]!.op.kind, '收官步为 done').toBe('done');

    // ---- 4. 思考区可见(UI):逐步折叠区,默认收起,展开读全文 ------------------
    for (const frame of thinkingFrames) {
      const trigger = page.getByRole('button', {
        name: new RegExp(`思考 · 步骤 ${frame.step ?? 0}`),
      });
      await expect(trigger, `思考区「思考 · 步骤 ${frame.step ?? 0}」须可见`).toBeVisible();
      await expect(trigger, '思考区默认收起(推理是次级信息)').toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
    const firstThinking = thinkingFrames[0]!;
    const firstTrigger = page.getByRole('button', {
      name: new RegExp(`思考 · 步骤 ${firstThinking.step ?? 1}`),
    });
    await firstTrigger.click();
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
    const snippet =
      (firstThinking.text ?? '')
        .split('\n')
        .find((line) => line.trim() !== '')
        ?.trim()
        .slice(0, 30) ?? '';
    await expect(
      page.getByText(snippet),
      '展开后帧文本原样可读(ThinkingText 直出不走 Markdown)',
    ).toBeVisible();

    // ---- 观测上报(计数/字符量/时延;不含任何凭证)-----------------------------
    console.log(
      `[llm-thinking] 观测:步数=${details.length},thinking 帧=${thinkingFrames.length},` +
        `reasoning 字符=${details.map((detail) => detail.reasoning?.length ?? 0).join('/')},` +
        `op 序列=${details.map((detail) => detail.op.kind).join('→')},回合时延=${elapsedMs}ms`,
    );
  });
});
