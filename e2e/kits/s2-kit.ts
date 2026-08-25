/**
 * S2 套件共享装置(s2.spec.ts 主链路 / s2-meta.spec.ts 治理场景共用):
 * /_meta 与业务合同客户端、事件/sitemap 断言形状、pin 提案 fields 构造、
 * 场景 server 生命周期(重放用例需要"不 TRUNCATE 的二次 boot")。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import type { TrailStep } from '@ui4a/agent';
import { expect } from '@playwright/test';

import {
  DATABASE_URL,
  SCENARIO_BASE,
  SCENARIO_PORT,
  truncateEvents,
  waitUntilHealthy,
  waitUntilPortFree,
} from './server-kit';

export const REPO_ROOT = path.join(__dirname, '..');
export const META_BASE = `${SCENARIO_BASE}/_meta`;
export const AGENT_PRINCIPAL = 'user:mike';
export const HUMAN_PRINCIPAL = 'local-user';

// ---- 合同客户端形状 -----------------------------------------------------------

export interface LoggedEvent {
  seq: number;
  kind: string;
  rel: string | null;
  action: string | null;
  actor: 'human' | 'agent' | null;
  principal: string | null;
  channel: string | null;
  reason: string | null;
  detail: unknown;
}

export interface EntityShape {
  class: string[];
  properties: Record<string, unknown>;
  actions: { name: string; title: string; fields?: Record<string, unknown> }[];
  entities?: EntityShape[];
  links?: { rel: string[]; href: string }[];
}

export interface SitemapShape {
  version: string;
  surfaces: { rel: string; title: string }[];
  flows: {
    name: string;
    nodes: { name: string; actions: { name: string; fields: Record<string, unknown> }[] }[];
  }[];
}

export async function getEntity(rel: string): Promise<EntityShape> {
  const response = await fetch(`${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET ${rel} 应为 200`).toBe(200);
  return (await response.json()) as EntityShape;
}

export async function getMetaEntity(rel: string): Promise<EntityShape> {
  const response = await fetch(`${META_BASE}/api/entity?rel=${encodeURIComponent(rel)}`);
  expect(response.status, `GET /_meta ${rel} 应为 200`).toBe(200);
  return (await response.json()) as EntityShape;
}

export async function exec(
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${SCENARIO_BASE}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

/** /_meta 站点 exec(agent 提议 / human 审批共用同一裁决端点)。 */
export async function execMeta(
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${META_BASE}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

export async function getEvents(): Promise<LoggedEvent[]> {
  const response = await fetch(`${SCENARIO_BASE}/api/events`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { events: LoggedEvent[] }).events;
}

export function eventsOf(events: LoggedEvent[], kind: string): LoggedEvent[] {
  return events.filter((event) => event.kind === kind);
}

export async function getSitemap(): Promise<SitemapShape> {
  const response = await fetch(`${SCENARIO_BASE}/.well-known/ui4a.json`);
  expect(response.status).toBe(200);
  return (await response.json()) as SitemapShape;
}

export function flowOf(sitemap: SitemapShape, name: string): SitemapShape['flows'][number] {
  const flow = sitemap.flows.find((candidate) => candidate.name === name);
  expect(flow, `sitemap 应含 flow ${name}`).toBeDefined();
  return flow!;
}

export function nodeActionsOf(
  flow: SitemapShape['flows'][number],
  node: string,
): { name: string; fields: Record<string, unknown> }[] {
  const found = flow.nodes.find((candidate) => candidate.name === node);
  expect(found, `flow ${flow.name} 应含节点 ${node}`).toBeDefined();
  return found!.actions;
}

/** runAgent 的 /_meta 合同选项(agent 经合同走定义平面)。 */
export function metaAgentOptions(maxSteps?: number): {
  baseUrl: string;
  fetchImpl: typeof fetch;
  startRel: string;
  actor: 'agent';
  principal: string;
  channel: string;
  maxSteps?: number;
} {
  return {
    baseUrl: META_BASE,
    fetchImpl: (url, init) => fetch(url, init),
    startRel: 'meta/flows',
    actor: 'agent',
    principal: AGENT_PRINCIPAL,
    channel: 'e2e',
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };
}

export function opKinds(steps: TrailStep[]): string[] {
  return steps.map((step) => step.op.kind);
}

/** add-action 的 goal.fields(与 lifecycle 声明的 node/action 参数 schema 对齐)。 */
function addPinGoalFields(
  node: string,
  to: string,
  effect: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    node,
    action: { name: 'pin', title: '置顶', to, guards: [], effect },
  };
}

/** article-drafting 的 pin(effect: transition;spec 架构决定 8 原样)。 */
export function pinOnReady(to: string): Record<string, unknown> {
  return addPinGoalFields('ready', to, [{ type: 'transition' }]);
}

/**
 * post-status 的 pin(第二次修订):published 自环 transition + set-field pinned。
 * 自环 = 置顶不改文章节点;set-field 让「文章实体出现 pin 相关状态」可断言。
 */
export function pinOnPublished(): Record<string, unknown> {
  return addPinGoalFields('published', 'published', [
    { type: 'transition' },
    { type: 'set-field', field: 'pinned', value: true },
  ]);
}

/** agent(直接 exec)把 seed 向导走到 ready——在途 v1 实例的装置。 */
export async function agentWalkWizardToReady(title: string): Promise<void> {
  const steps = [
    { action: 'next', params: { title } },
    { action: 'next', params: { category: 'tech', tags: 's2' } },
    { action: 'next', params: { body: 'S2 场景正文:在途实例按出生版本走完。' } },
  ];
  for (const step of steps) {
    const { status } = await exec({
      rel: 'article-drafting:main',
      action: step.action,
      params: step.params,
      actor: 'agent',
      principal: AGENT_PRINCIPAL,
      channel: 'e2e',
    });
    expect(status, `向导 ${step.action} 应 200`).toBe(200);
  }
}

// ---- 场景 server 生命周期(重放用例需要"不 TRUNCATE 的二次 boot")--------------

export interface ServerHandle {
  kill: () => Promise<void>;
}

async function killGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // 已退出。
  }
  await waitUntilPortFree(SCENARIO_PORT, 15_000);
}

/** 自起场景 dev server(3110,独立 distDir;缺省先 TRUNCATE,重放二次 boot 关闭)。 */
export async function spawnScenarioServer(options?: {
  truncateFirst?: boolean;
}): Promise<ServerHandle> {
  await waitUntilPortFree(SCENARIO_PORT, 15_000);
  if (options?.truncateFirst !== false) {
    await truncateEvents();
  }
  const child: ChildProcess = spawn('pnpm', ['dev'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(SCENARIO_PORT),
      UI4A_DIST_DIR: '.next-e2e',
      DATABASE_URL,
    },
    detached: true,
    stdio: 'ignore',
  });
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  await waitUntilHealthy(SCENARIO_BASE, 90_000);
  if (exited) {
    throw new Error('场景 dev server 提前退出(检查端口 3110 是否被占用)');
  }
  return {
    kill: async () => {
      await killGroup(child).catch(() => undefined);
    },
  };
}
