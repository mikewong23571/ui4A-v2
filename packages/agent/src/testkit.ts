/**
 * 测试共用装置:脚本化 fetch 与 Siren 实体夹具(真实投影形状的手工副本)。
 *
 * 循环协议的单元测试不触网:FetchLike 由内存路由表实现;
 * 实体夹具与 packages/engine 的 Siren 投影输出逐字段对齐
 * (properties.actions/links/guard-results/entities)。
 */
import type { SirenAction, SirenEntity, SirenLink } from '@ui4a/engine';

import type { FetchLike } from './types';

/** 一次 HTTP 调用的记录(body 已解析)。 */
export interface RecordedCall {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

/** 脚本化传输:responder 同步决定响应;所有调用留痕。 */
export function createScriptedTransport(
  responder: (url: string, init?: RequestInit) => Response,
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const rawBody = init?.body;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body:
        typeof rawBody === 'string'
          ? (JSON.parse(rawBody) as Record<string, unknown>)
          : undefined,
    });
    return responder(url, init);
  };
  return { fetch, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function entityUrl(baseUrl: string, rel: string): string {
  return `${baseUrl}/api/entity?rel=${encodeURIComponent(rel)}`;
}

export function execUrl(baseUrl: string): string {
  return `${baseUrl}/api/exec`;
}

// ---- Siren 夹具构造(与 engine 投影输出同形)-------------------------------

export function emptyFieldsSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  };
}

export interface InstanceFixture {
  rel: string;
  flow: string;
  node: string;
  title?: string;
  fields?: Record<string, unknown>;
  actions?: SirenAction[];
  collection?: string;
  guardResults?: Array<{ action: string; blocked: boolean; reason?: string }>;
}

export function instanceEntity(fixture: InstanceFixture): SirenEntity {
  const links: SirenLink[] = [
    { rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(fixture.rel)}` },
  ];
  if (fixture.collection !== undefined) {
    links.push({
      rel: ['collection'],
      href: `/api/entity?rel=${encodeURIComponent(fixture.collection)}`,
    });
  }
  const entity: SirenEntity = {
    class: ['flow-instance', fixture.flow],
    properties: {
      rel: fixture.rel,
      flow: fixture.flow,
      node: fixture.node,
      title: fixture.title ?? fixture.node,
      fields: fixture.fields ?? {},
    },
    actions: fixture.actions ?? [],
    links,
    'guard-results': (fixture.guardResults ?? []).map((entry) => ({
      action: entry.action,
      blocked: entry.blocked,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      guards: [],
    })),
  };
  return entity;
}

export interface CollectionFixture {
  rel: string;
  members: InstanceFixture[];
}

export function collectionEntity(fixture: CollectionFixture): SirenEntity {
  const entities = fixture.members.map((member) => {
    const projected = instanceEntity(member);
    return {
      ...projected,
      rel: ['item'],
      href: `/api/entity?rel=${encodeURIComponent(member.rel)}`,
    };
  });
  return {
    class: ['collection', fixture.rel],
    properties: { rel: fixture.rel, count: fixture.members.length },
    actions: [],
    links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(fixture.rel)}` }],
    'guard-results': [],
    entities,
  };
}
