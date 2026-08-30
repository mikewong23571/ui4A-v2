import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createContractClient, type FetchLike, type TrailStep } from '@ui4a/agent';

import type { ChatTurnProgressDetail } from '../../../chat/history';
import { sitemapTitlesFromSummary, stepActivityData } from '../../../chat/step-activity';
import type { ChatStepActivity } from '../../../chat/sse';
import { readLog } from '@ui4a/db/events';

import {
  chat,
  chatRouteBase,
  createOperationsLlmStub,
  defaultApplicationView,
  pool,
  PUBLISH_TEST_AUTHORIZATION,
  PUBLISH_TEST_GOAL,
  startChatRouteFixtures,
  stopChatRouteFixtures,
} from './route-test-kit';

/**
 * T31 R1(←T24 验收缺口):step 帧的 activity/eventSeq 接线此前只在合成 SSE
 * 与机器文本断言中出现,真实 route 形状上无断言。本文件经 route-test-kit 的
 * 进程内回环调用真实 POST /api/chat handler,解析 SSE 流,断言:
 * 1. step 帧携带结构化 activity(op + 合同 sitemap 投影的 title);
 * 2. 帧内 eventSeq 是事件日志里真实存在的 chat-turn-progress 日志 seq;
 * 3. 断言不钉死任何 site 词表值——标题预期一律由「同一读端的 sitemap 摘要 +
 *    sitemapTitlesFromSummary」机械推导,合同改名测试不误红。
 */

/** T24 接线后的 step 帧形状(kit 的 SseFrame 未含 activity/eventSeq;本地窄化)。 */
interface WiredStepFrame {
  type: 'step';
  turnId?: string;
  message?: { role: 'assistant'; text: string };
  activity?: ChatStepActivity;
  eventSeq?: number;
}

// 脚本化 LLM 桩:三步 next 填充 + publish + done(与 createPublishingLlmStub
// 同一操作序列,共用 PUBLISH_TEST_AUTHORIZATION 过 selection 门)。
const R1_OPERATIONS = [
  {
    name: 'exec',
    args: {
      action: 'next',
      params: { title: 'LLM 发布标题' },
      authorization: PUBLISH_TEST_AUTHORIZATION,
    },
  },
  {
    name: 'exec',
    args: {
      action: 'next',
      params: { category: 'tech', tags: 'r1' },
      authorization: PUBLISH_TEST_AUTHORIZATION,
    },
  },
  {
    name: 'exec',
    args: {
      action: 'next',
      params: { body: 'R1 正文' },
      authorization: PUBLISH_TEST_AUTHORIZATION,
    },
  },
  {
    name: 'exec',
    args: {
      action: 'publish',
      params: { title: 'LLM 发布标题' },
      authorization: PUBLISH_TEST_AUTHORIZATION,
    },
  },
  { name: 'done', args: { summary: 'LLM 完成发布' } },
];

function r1Goal(): { verb: string; fields: Record<string, string> } {
  return {
    verb: PUBLISH_TEST_GOAL,
    fields: { title: '接线验证', category: 'tech', tags: '', body: '正文' },
  };
}

// 与既有 route 级测试同一基座:每例起进程内回环(真实 route handler)+ 清库。
beforeEach(startChatRouteFixtures);
afterEach(stopChatRouteFixtures);

describe('T31 R1:inline step 帧的真实 route 接线(activity/eventSeq)', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;
  let stub: Awaited<ReturnType<typeof createOperationsLlmStub>>;

  beforeEach(async () => {
    stub = await createOperationsLlmStub(R1_OPERATIONS);
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
    process.env.LLM_MODEL = 'test-model';
  });

  afterEach(async () => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  function wiredStepFrames(frames: unknown[]): WiredStepFrame[] {
    return frames.filter((frame) => (frame as WiredStepFrame).type === 'step') as WiredStepFrame[];
  }

  it('step 帧携带结构化 activity,title 经 sitemapTitlesFromSummary 注入自合同 sitemap', async () => {
    const { json, frames } = await chat({
      sessionId: 'r1-activity',
      goal: r1Goal(),
      clientView: defaultApplicationView('client:r1-activity'),
    });
    expect(json.outcome).toBe('done');

    // 预期与 route 同源:route 只 GET 一次合同 sitemap;此处按同一端点、
    // 同一客户端投影出标题索引,再以纯函数生成每步预期——零词表字面值。
    const fetchLike: FetchLike = (url, init) => fetch(url, init);
    const sitemap = await createContractClient(chatRouteBase(), fetchLike).getSitemap();
    const expectedTitles = sitemapTitlesFromSummary(sitemap);

    const trailSteps = (json.steps ?? []) as TrailStep[];
    const stepFrames = wiredStepFrames(frames);
    expect(trailSteps.length).toBeGreaterThan(0);
    expect(stepFrames.length).toBe(trailSteps.length);

    stepFrames.forEach((frame, index) => {
      const step = trailSteps[index]!;
      expect(frame.turnId, 'step 帧归回合').toBe(json.turnId);
      expect(frame.message?.text).toBeTruthy();
      // 结构化 activity 与「TrailStep + 合同标题索引」的纯函数投影逐字段等值
      // (op 为协议动词原样;title 来自 sitemap,而非 rel/动作名兜底)。
      expect(frame.activity).toBeDefined();
      expect(frame.activity).toEqual(stepActivityData(step, expectedTitles));
    });

    // 注入性证明(不写死标题字面值):至少一步的合同投影与「无标题索引」的
    // 兜底投影不同——证明 title 确实来自 sitemap 注入通道而非机械兜底;
    // 若合同所有标题恰好与标识同文,此证据自然退化为等值断言本身。
    const injectedAtLeastOnce = stepFrames.some(
      (frame, index) =>
        JSON.stringify(frame.activity) !==
        JSON.stringify(stepActivityData(trailSteps[index]!, undefined)),
    );
    expect(injectedAtLeastOnce).toBe(true);
  });

  it('eventSeq 是事件日志真实指针:回读恰为本回合 chat-turn-progress,且逐帧递增', async () => {
    const sessionId = 'r1-event-seq';
    const { json, frames } = await chat({
      sessionId,
      goal: r1Goal(),
      clientView: defaultApplicationView('client:r1-event-seq'),
    });
    expect(json.outcome).toBe('done');

    const stepFrames = wiredStepFrames(frames);
    expect(stepFrames.length).toBeGreaterThan(0);

    // 帧内指针形状:正整数;随发送序严格递增(append-only 单调 seq)。
    const seqs = stepFrames.map((frame) => frame.eventSeq);
    for (const seq of seqs) {
      expect(
        typeof seq === 'number' && Number.isInteger(seq) && seq > 0,
        `eventSeq 应为正整数,实得 ${String(seq)}`,
      ).toBe(true);
    }
    for (let index = 1; index < seqs.length; index += 1) {
      expect(seqs[index]!).toBeGreaterThan(seqs[index - 1]!);
    }

    // 读端回读(db/events 读函数):每个 eventSeq 恰命中一条日志事件,
    // kind 为 chat-turn-progress,detail 归属本回合且与帧内容一致。
    const events = await readLog(pool);
    const progressBySeq = new Map(
      events
        .filter((event) => event.kind === 'chat-turn-progress')
        .map((event) => [event.seq, event]),
    );
    const turnProgress = [...progressBySeq.values()].filter(
      (event) => (event.detail as ChatTurnProgressDetail | undefined)?.sessionId === sessionId,
    );
    expect(turnProgress.length).toBe(stepFrames.length);

    stepFrames.forEach((frame) => {
      const event = progressBySeq.get(frame.eventSeq!);
      expect(event, `seq ${frame.eventSeq} 应在事件日志中可回读`).toBeDefined();
      expect(event!.kind).toBe('chat-turn-progress');
      const detail = event!.detail as ChatTurnProgressDetail;
      expect(detail.sessionId).toBe(sessionId);
      expect(detail.turnId).toBe(frame.turnId);
      expect(detail.message.text).toBe(frame.message?.text);
      expect(detail.step?.rel).toBeTypeOf('string');
    });
  });
});
