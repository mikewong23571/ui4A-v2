/**
 * HTTP 合同客户端(极薄):/api/entity 与 /api/exec 的 fetch 封装。
 *
 * fetchImpl 由调用方注入——测试用脚本化传输,E2E/生产用真实 fetch;
 * 包本身零 Node API 依赖,浏览器/服务端两栖。
 * 错误语义:网络异常不抛出,折算为"不可得/拒绝"结果交循环按数据处理
 * (失败也是合同的一部分,B4 的委托不崩溃前提)。
 */
import type { SirenEntity } from '@ui4a/engine';

import type { FetchLike, SitemapApplicationSummary, SitemapSummary } from './types';

/** exec 请求体(HTTP 合同的 POST 载荷形状)。 */
export interface ExecPayload {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
  actor?: 'human' | 'agent';
  principal?: string;
  channel?: string;
}

export interface EntityFetchResult {
  status: number;
  entity?: SirenEntity;
  error?: string;
}

export interface ExecCallResult {
  status: number;
  ok: boolean;
  entity?: SirenEntity;
  layer?: string;
  reason?: string;
  detail?: unknown;
}

export interface ContractClient {
  getEntity(rel: string): Promise<EntityFetchResult>;
  exec(payload: ExecPayload): Promise<ExecCallResult>;
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
function asApplicationSummaries(value: unknown): SitemapApplicationSummary[] {
  if (!Array.isArray(value)) return [];
  const applications: SitemapApplicationSummary[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.name !== 'string' || typeof entry.intent !== 'string') continue;
    const flows = (Array.isArray(entry.flows) ? entry.flows : [])
      .filter(
        (flow): flow is { name: string; title: string } =>
          isPlainObject(flow) && typeof flow.name === 'string' && typeof flow.title === 'string',
      )
      .map((flow) => ({ name: flow.name, title: flow.title }));
    applications.push({ name: entry.name, intent: entry.intent, flows });
  }
  return applications;
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
            (surface): surface is { rel: string; title: string } =>
              isPlainObject(surface) &&
              typeof surface.rel === 'string' &&
              typeof surface.title === 'string',
          )
          .map((surface) => ({ rel: surface.rel, title: surface.title }));
        return {
          version: body.version,
          surfaces,
          applications: asApplicationSummaries(body.applications),
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
  };
}
