/**
 * 工作线工作台 E2E 共享 fixture/助手(T56 P4.1 常驻用户故事覆盖)。
 *
 * - 全部数据经规范 `/api/exec` create/attach 与真实 Cedar 确认门产生
 *   (acceptance §1:agent 提议 202 挂起 → 人类 approve/reject),零身份伪装、
 *   零 Cedar 修改、零直接事件写(例外:history spec 的「旧版回合」DB seed,
 *   限定隔离测试库 harness,见该文件头注);
 * - 每场景唯一前缀 `t56-<runId>`(防跨轮次残留);
 * - 截图:默认关闭;`UI4A_E2E_SHOTS_DIR` 指向证据目录时落盘
 *   (track 证据采集口,常驻代码零 track 路径依赖)。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';

import { terminateStaleNotifyWorkflows } from '../../apps/web/src/temporal/notify';
import { SCENARIO_BASE } from '../kits/server-kit';

/** chat 回合确定性诚实失败的三项显式清空(压过 .env.local;与 chat.spec U22 同口径)。 */
export const NO_LLM_ENV = { LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '' };

/** 每场景唯一前缀(acceptance §1:`t56-<runId>`)。 */
export function runId(): string {
  return `t56-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function execAction(
  page: Page,
  rel: string,
  action: string,
  params?: Record<string, unknown>,
  principal = 'local-user',
): Promise<void> {
  const response = await page.request.post(`${SCENARIO_BASE}/api/exec`, {
    data: {
      rel,
      action,
      ...(params === undefined ? {} : { params }),
      actor: 'human',
      principal,
      channel: 'e2e',
    },
  });
  expect(response.ok()).toBe(true);
}

/** A 线最小集(US01/05/07 等既有用例口径):open + 目标 + context + active + dangling approval。 */
export async function createThreadFixture(page: Page, threadId: string): Promise<void> {
  await execAction(page, 'threads', 'create', {
    commandId: threadId,
    goal: '完成一项跨应用评审并记录决定',
  });
  await execAction(page, `thread:${threadId}`, 'attach', { category: 'context', rel: 'articles' });
  await execAction(page, `thread:${threadId}`, 'attach', {
    category: 'active',
    rel: 'article-drafting:main',
  });
  await execAction(page, `thread:${threadId}`, 'attach', {
    category: 'approval',
    rel: `confirmation:${threadId}`,
  });
}

export interface FullThreadFixture {
  thread: string;
  /** 待决 approval(确认 rel;agent 提议 pending)。 */
  pending: string;
  /** 已决定 approval(人类驳回,带原因;原动作不执行)。 */
  decided: string;
}

/** agent 经 HTTP 合同提议 post archive(需 high 确认)→ 202 挂起,返回确认 rel。 */
export async function proposePostArchive(page: Page): Promise<string> {
  const response = await page.request.post(`${SCENARIO_BASE}/api/exec`, {
    data: {
      rel: 'post:post-welcome',
      action: 'archive',
      actor: 'agent',
      principal: 'user:mike',
      channel: 'e2e',
    },
  });
  expect(response.status()).toBe(202);
  const body = (await response.json()) as { confirmation?: { rel?: string } };
  expect(body.confirmation?.rel).toMatch(/^confirmation:/);
  return body.confirmation!.rel!;
}

/** 人类在确认实体上裁决(approve/reject 走原确认闸门;reject 需原因)。 */
export async function decideConfirmation(
  page: Page,
  rel: string,
  decision: 'approve' | 'reject',
  reason?: string,
): Promise<void> {
  await execAction(page, rel, decision, reason === undefined ? {} : { reason });
}

/**
 * 提议型 fixture 的 notify workflow 卫生(与 workstation-home terminateStale
 * 同口径):提议挂起会经 UI4A_NOTIFY_DISPATCH 尽力而为启动 notify-<id>
 * workflow(引擎确定性分配 c1/c2);本套件场景无 worker,workflow 悬在共享
 * 隔离 Temporal 上,后续 worker 栈用例(如 workstation-home)spawn worker
 * 时会被误投递到**它们**的场景 server,污染首笔 exec。场景前后各终止一次,
 * 尽力而为、不可达即兜底吞掉。
 */
export async function cleanupNotifyWorkflows(): Promise<void> {
  await terminateStaleNotifyWorkflows(['c1', 'c2']);
}

/**
 * acceptance §1 Fixture A 完整集:open + 明确目标 + 跨两个 application 的
 * context(publishing articles + community comment:c1)+ 一条 active +
 * 已决定(驳回)与待决各一条 approval + 一个显式 event(审计链接 event:1)。
 * 确认序确定性:首个提议 → c<seq>,驳回后原动作不执行(文章保持 published),
 * 第二次提议可再次挂起。
 */
export async function createFullThreadFixture(
  page: Page,
  threadId: string,
): Promise<FullThreadFixture> {
  const decided = await proposePostArchive(page);
  await decideConfirmation(page, decided, 'reject', '证据不足，先补材料');
  const pending = await proposePostArchive(page);
  await execAction(page, 'threads', 'create', {
    commandId: threadId,
    goal: '完成一项跨应用评审并记录决定',
  });
  await execAction(page, `thread:${threadId}`, 'attach', { category: 'context', rel: 'articles' });
  await execAction(page, `thread:${threadId}`, 'attach', {
    category: 'context',
    rel: 'comment:c1',
  });
  await execAction(page, `thread:${threadId}`, 'attach', {
    category: 'active',
    rel: 'article-drafting:main',
  });
  await execAction(page, `thread:${threadId}`, 'attach', { category: 'approval', rel: decided });
  await execAction(page, `thread:${threadId}`, 'attach', { category: 'approval', rel: pending });
  await execAction(page, `thread:${threadId}`, 'attach', { category: 'event', rel: 'event:1' });
  return { thread: threadId, pending, decided };
}

/** 本线成员按语义呈现为摘要行或决定卡;data-rel 始终是被引对象。 */
export function memberCard(page: Page, rel: string): Locator {
  return page.locator(
    `[data-word="member-card"][data-rel="${rel}"], [data-word="member-row"][data-rel="${rel}"]`,
  );
}

/** 打开本线概览并等 surface 上屏(冷编译窗口放宽)。 */
export async function openThreadOverview(page: Page, threadId: string): Promise<void> {
  await page.goto(`${SCENARIO_BASE}/canvas?thread=${threadId}&focus=thread%3A${threadId}`);
  await expect(page.locator('[data-surface]').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * chat 回合诚实失败(LLM 未配置)的可见主行(T24 失败措辞分层:机械 code 的
 * 中性结构化行「失败 · code=…」;LLM 不可用细节在可展开「失败数据」折叠层)。
 */
export async function expectAssistantTurnFailed(page: Page): Promise<void> {
  await expect(page.getByText(/^失败 · code=/).first()).toBeVisible({ timeout: 30_000 });
}

export async function sendChatGoal(page: Page, goal: string): Promise<void> {
  await page.getByPlaceholder('输入目标…').fill(goal);
  await page.getByRole('button', { name: '发送' }).click();
}

const SHOTS_DIR = process.env.UI4A_E2E_SHOTS_DIR ?? '';

/** 证据截图(零修图):设置 UI4A_E2E_SHOTS_DIR 时落盘,否则空操作。 */
export async function saveShot(page: Page, name: string): Promise<void> {
  if (SHOTS_DIR === '') return;
  mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: true });
}
