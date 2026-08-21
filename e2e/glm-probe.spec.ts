/**
 * T11 Phase A — GLM-5.3 探针(RUN_LLM_E2E + GLM_API_KEY 双门控,默认 skip)。
 *
 * 实测 glm-5.3 经 @ai-sdk/openai chat provider(Chat Completions,D7)的
 * reasoning 暴露形态、tool calling 行为(auto)与每步决策时延;结论决定
 * T11 thinking 帧格式并校准 D7/D20 口径(spec:架构决定 1 / 验收 2)。
 *
 * ```bash
 * GLM_API_KEY=$(cat ~/.secrets/glm_coding_plan_key) RUN_LLM_E2E=1 \
 *   CI=true pnpm exec playwright test e2e/glm-probe.spec.ts
 * ```
 *
 * 直连 GLM 端点(不起场景 server、不清库;探针内核见 packages/agent/src/
 * llm-probe.ts)。每轮为真实网络往返(推理模型 effort 缺省 max,D20),超时给足;
 * 观测全文打印到 stdout 并落 test-results/glm-probe-report.md(gitignored)。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import {
  formatProbeReport,
  runGenerateProbe,
  runStreamProbe,
  type GlmProbeObservation,
} from '@ui4a/agent';

test.skip(
  !process.env.RUN_LLM_E2E || !process.env.GLM_API_KEY,
  'RUN_LLM_E2E/GLM_API_KEY 未设置(真实 GLM 探针,默认 skip)',
);

// 每模式样本数:单次决策 8–60s+(D7 8–20s;D20 注记 effort max 可能更高),3+3
// 兼顾时延区间置信度与探针总时长。
const RUNS_PER_MODE = 3;

test('GLM-5.3 探针:reasoning 暴露形态 / tool calling / 每步时延实测', async () => {
  test.setTimeout(900_000);
  const observations: GlmProbeObservation[] = [];
  for (let index = 0; index < RUNS_PER_MODE; index++) {
    observations.push(await runGenerateProbe());
  }
  for (let index = 0; index < RUNS_PER_MODE; index++) {
    observations.push(await runStreamProbe());
  }

  const report = formatProbeReport(observations);
  console.log(`\n${report}\n`);
  const reportPath = path.join(__dirname, '..', 'test-results', 'glm-probe-report.md');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report, 'utf8');

  // 断言 = 实测校准后的探针红线:失败即 GLM 行为漂移,需重新实测并更 DECISIONS。
  const generate = observations.filter((entry) => entry.mode === 'generateText');
  const stream = observations.filter((entry) => entry.mode === 'streamText');
  for (const entry of observations) {
    expect(entry.error, `${entry.mode} 调用出错`).toBeNull();
  }
  // tool calling(auto):两种模式每次调用都必须产出 tool call(D7 口径)。
  for (const entry of generate) {
    expect(entry.toolCalls.length, 'generateText 应返回 tool call(auto)').toBeGreaterThan(0);
  }
  for (const entry of stream) {
    expect(entry.toolCalls.length, 'streamText 应返回 tool call(auto)').toBeGreaterThan(0);
  }
  // reasoning:SDK 层或原始 HTTP 层至少一处必须观测到(effort 缺省 max,D20)。
  for (const entry of observations) {
    expect(
      entry.sdkReasoningText !== null || entry.rawReasoningText !== null,
      `${entry.mode} 未观测到 reasoning(SDK 层 ${entry.sdkReasoningPartCount} parts;原始层键 [${entry.rawMessageKeys.join(', ')}])`,
    ).toBe(true);
  }
});
