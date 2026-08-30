/**
 * HTTP 合同客户端(极薄):/api/entity 与 /api/exec 的 fetch 封装。
 *
 * fetchImpl 由调用方注入——测试用脚本化传输,E2E/生产用真实 fetch;
 * 包本身零 Node API 依赖,浏览器/服务端两栖。
 * 错误语义:网络异常不抛出,折算为"不可得/拒绝"结果交循环按数据处理
 * (失败也是合同的一部分,B4 的委托不崩溃前提)。
 */
import { parseCognitiveSemanticsProjection, type SirenEntity } from '@ui4a/engine';

import type {
  FetchLike,
  SitemapActionSummary,
  SitemapApplicationSummary,
  SitemapCapabilitySummary,
  SitemapFlowSummary,
  SitemapSummary,
} from '../types';

/** exec 请求体(HTTP 合同的 POST 载荷形状)。 */
export interface ExecPayload {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
  actor?: 'human' | 'agent';
  principal?: string;
  channel?: string;
  authorization?: { sourceMessageId: string; quote: string };
}

export interface EntityFetchResult {
  status: number;
  entity?: SirenEntity;
  error?: string;
}

export interface ExecCallResult {
  status: number;
  ok: boolean;
  suspended?: boolean;
  entity?: SirenEntity;
  confirmationRel?: string;
  layer?: string;
  reason?: string;
  detail?: unknown;
}

export interface ExecPlanCallResult {
  status: number;
  outcome: 'completed' | 'rejected' | 'suspended';
  reason?: string;
  /** 引擎逐步裁决报告；拒绝即数据，driver 需要看到具体失败步。 */
  detail?: unknown;
  confirmationRel?: string;
}

export interface ContractClient {
  getEntity(rel: string): Promise<EntityFetchResult>;
  exec(payload: ExecPayload): Promise<ExecCallResult>;
  execPlan(payload: {
    steps: { rel: string; action: string; params?: Record<string, unknown> }[];
    actor?: 'human' | 'agent';
    principal?: string;
    channel?: string;
    authorization?: { sourceMessageId: string; quote: string };
  }): Promise<ExecPlanCallResult>;
  /** sitemap(/.well-known/ui4a.json);不可得时返回 undefined,不抛(循环按数据降级)。 */
  getSitemap(): Promise<SitemapSummary | undefined>;
}

interface JsonObject {
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 最小形状校验:Siren 实体必须有四件组装的骨架。 */
function asSirenEntity(value: unknown): SirenEntity | undefined {
  if (!isPlainObject(value)) return undefined;
  if (!Array.isArray(value.actions) || !Array.isArray(value.links)) return undefined;
  if (!isPlainObject(value.properties) || !Array.isArray(value.class)) return undefined;
  // 断言理由:骨架字段已逐项校验,其余成员按合同信任(HTTP 边界的运行时形状收敛)。
  return value as unknown as SirenEntity;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (isPlainObject(body) && typeof body.error === 'string') return body.error;
  if (isPlainObject(body) && typeof body.reason === 'string') return body.reason;
  return fallback;
}

/**
 * sitemap JSON 的 applications 分组 → agent 摘要(宽容解析:字段缺失的
 * 条目跳过;旧形状无 applications 字段 → 空数组,静态上下文退化为扁平)。
 */
function asFlowSummaries(value: unknown): SitemapFlowSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((flow) => {
    if (!isPlainObject(flow) || typeof flow.name !== 'string' || typeof flow.title !== 'string') {
      return [];
    }
    const actions: SitemapActionSummary[] = [];
    const directActions = Array.isArray(flow.actions) ? flow.actions : [];
    for (const action of directActions) {
      if (
        isPlainObject(action) &&
        typeof action.name === 'string' &&
        typeof action.title === 'string' &&
        typeof action.node === 'string'
      ) {
        actions.push({
          name: action.name,
          title: action.title,
          node: action.node,
          guards: Array.isArray(action.guards)
            ? action.guards.filter((guard): guard is string => typeof guard === 'string')
            : [],
        });
      }
    }
    for (const node of Array.isArray(flow.nodes) ? flow.nodes : []) {
      if (!isPlainObject(node) || typeof node.name !== 'string') continue;
      for (const action of Array.isArray(node.actions) ? node.actions : []) {
        if (
          !isPlainObject(action) ||
          typeof action.name !== 'string' ||
          typeof action.title !== 'string'
        ) {
          continue;
        }
        actions.push({
          name: action.name,
          title: action.title,
          node: node.name,
          guards: Array.isArray(action.guards)
            ? action.guards.filter((guard): guard is string => typeof guard === 'string')
            : [],
        });
      }
    }
    const edges = (Array.isArray(flow.edges) ? flow.edges : []).flatMap((edge) =>
      isPlainObject(edge) &&
      typeof edge.from === 'string' &&
      typeof edge.action === 'string' &&
      typeof edge.to === 'string'
        ? [{ from: edge.from, action: edge.action, to: edge.to }]
        : [],
    );
    return [
      {
        name: flow.name,
        title: flow.title,
        actions,
        ...(Array.isArray(flow.edges) ? { edges } : {}),
      },
    ];
  });
}

function asApplicationSummaries(value: unknown): SitemapApplicationSummary[] {
  if (!Array.isArray(value)) return [];
  const applications: SitemapApplicationSummary[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.name !== 'string' || typeof entry.intent !== 'string') continue;
    const flows = asFlowSummaries(entry.flows).map((flow) => ({
      name: flow.name,
      title: flow.title,
      ...(flow.actions === undefined ? {} : { actions: flow.actions }),
    }));
    const presentation = parseCognitiveSemanticsProjection(entry.presentation);
    applications.push({
      name: entry.name,
      intent: entry.intent,
      ...(presentation === undefined ? {} : { presentation }),
      flows,
    });
  }
  return applications;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function asCapabilitySummaries(value: unknown): SitemapCapabilitySummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.name !== 'string' ||
      typeof entry.title !== 'string' ||
      !['transform', 'extract', 'effect'].includes(String(entry.kind)) ||
      typeof entry.intent !== 'string' ||
      !isPlainObject(entry.scope)
    ) {
      return [];
    }
    return [
      {
        name: entry.name,
        title: entry.title,
        kind: entry.kind as SitemapCapabilitySummary['kind'],
        intent: entry.intent,
        ...(typeof entry.input === 'string' ? { input: entry.input } : {}),
        ...(typeof entry.output === 'string' ? { output: entry.output } : {}),
        ...(isPlainObject(entry.inputSchema) ? { inputSchema: entry.inputSchema } : {}),
        ...(isPlainObject(entry.outputSchema) ? { outputSchema: entry.outputSchema } : {}),
        scope: {
          applications: stringArray(entry.scope.applications),
          flows: stringArray(entry.scope.flows),
        },
      },
    ];
  });
}

export function createContractClient(baseUrl: string, fetchImpl: FetchLike): ContractClient {
  const root = baseUrl.replace(/\/+$/, '');
  return {
    async getSitemap(): Promise<SitemapSummary | undefined> {
      try {
        const response = await fetchImpl(`${root}/.well-known/ui4a.json`);
        if (response.status !== 200) return undefined;
        const body = await readJson(response);
        if (!isPlainObject(body) || typeof body.version !== 'string') return undefined;
        if (!Array.isArray(body.surfaces)) return undefined;
        const surfaces = body.surfaces
          .filter(
            (
              surface,
            ): surface is {
              rel: string;
              title: string;
              app?: string;
              presentation?: unknown;
            } =>
              isPlainObject(surface) &&
              typeof surface.rel === 'string' &&
              typeof surface.title === 'string',
          )
          .map((surface) => {
            const presentation = parseCognitiveSemanticsProjection(surface.presentation);
            return {
              rel: surface.rel,
              title: surface.title,
              ...(typeof surface.app === 'string' ? { app: surface.app } : {}),
              ...(presentation === undefined ? {} : { presentation }),
            };
          });
        return {
          version: body.version,
          surfaces,
          applications: asApplicationSummaries(body.applications),
          flows: asFlowSummaries(body.flows),
          capabilities: asCapabilitySummaries(body.capabilities),
        };
      } catch {
        return undefined;
      }
    },
    async getEntity(rel: string): Promise<EntityFetchResult> {
      const url = `${root}/api/entity?rel=${encodeURIComponent(rel)}`;
      try {
        const response = await fetchImpl(url);
        const body = await readJson(response);
        const entity = response.status === 200 ? asSirenEntity(body) : undefined;
        if (entity !== undefined) {
          return { status: response.status, entity };
        }
        return {
          status: response.status,
          error: errorMessage(body, `实体 "${rel}" 不可得(HTTP ${response.status})`),
        };
      } catch (error) {
        return {
          status: 0,
          error: `实体 "${rel}" 请求失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    async exec(payload: ExecPayload): Promise<ExecCallResult> {
      try {
        const response = await fetchImpl(`${root}/api/exec`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await readJson(response);
        if (response.status === 200 && isPlainObject(body)) {
          const entity = asSirenEntity(body.entity);
          if (entity !== undefined) {
            return { status: response.status, ok: true, entity };
          }
        }
        if (
          response.status === 202 &&
          isPlainObject(body) &&
          body.status === 'suspended' &&
          isPlainObject(body.confirmation) &&
          typeof body.confirmation.rel === 'string'
        ) {
          return {
            status: response.status,
            ok: false,
            suspended: true,
            confirmationRel: body.confirmation.rel,
            detail: body.confirmation,
          };
        }
        return {
          status: response.status,
          ok: false,
          layer: isPlainObject(body) && typeof body.layer === 'string' ? body.layer : undefined,
          reason: errorMessage(body, `exec 被拒(HTTP ${response.status})`),
          detail: isPlainObject(body) ? body.detail : undefined,
        };
      } catch (error) {
        return {
          status: 0,
          ok: false,
          reason: `exec 请求失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    async execPlan(payload): Promise<ExecPlanCallResult> {
      try {
        const response = await fetchImpl(`${root}/api/exec-plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await readJson(response);
        if (isPlainObject(body)) {
          if (response.status === 200 && body.plan === 'completed') {
            return { status: response.status, outcome: 'completed' };
          }
          if (response.status === 200 && body.plan === 'rejected') {
            const results = Array.isArray(body.results) ? body.results : [];
            const rejected = results.find(
              (result) => isPlainObject(result) && result.outcome === 'rejected',
            );
            const reason =
              isPlainObject(rejected) && typeof rejected.reason === 'string'
                ? rejected.reason
                : '计划中有步骤被拒绝';
            return {
              status: response.status,
              outcome: 'rejected',
              reason,
              detail: { results },
            };
          }
          if (
            response.status === 202 &&
            body.plan === 'suspended' &&
            isPlainObject(body.confirmation)
          ) {
            return {
              status: response.status,
              outcome: 'suspended',
              ...(typeof body.confirmation.rel === 'string'
                ? { confirmationRel: body.confirmation.rel }
                : {}),
            };
          }
        }
        return {
          status: response.status,
          outcome: 'rejected',
          reason: errorMessage(body, `exec-plan 被拒(HTTP ${response.status})`),
        };
      } catch (error) {
        return {
          status: 0,
          outcome: 'rejected',
          reason: `exec-plan 请求失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
