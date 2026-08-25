/**
 * agent 循环协议单测的共享夹具(自 loop.test.ts 头部抽出,行为不变):
 * - 循环零智能:driver 决定一切,循环只负责取实体/执行操作/记录轨迹;
 * - 终止:done / fail / maxSteps / 起始实体不可得;
 * - 拒绝即数据:exec 4xx 与 navigate 404 都作为 lastRejection 回流下一步上下文(仅一步);
 * - exec 请求体携带 rel/action/params/actor/principal/channel。
 */
import type { SirenEntity } from '@ui4a/engine';

import {
  collectionEntity,
  createScriptedTransport,
  execUrl,
  instanceEntity,
  jsonResponse,
} from '../testkit/testkit';
import type { AgentDriver, AgentGoal, AgentOperation, DriverContext } from '../types';

export const BASE = 'http://contract.test';

export const GOAL: AgentGoal = { verb: '测试目标' };

export const articlesEntity = collectionEntity({
  rel: 'articles',
  members: [
    { rel: 'post:post-welcome', flow: 'post-status', node: 'published' },
    { rel: 'post:first-post', flow: 'post-status', node: 'published' },
  ],
});

export const postWelcomeEntity = instanceEntity({
  rel: 'post:post-welcome',
  flow: 'post-status',
  node: 'published',
});

/** 按脚本依次决策的 driver(耗尽后 fail,测试显式给出全部决策)。 */
export class ScriptedDriver implements AgentDriver {
  readonly contexts: DriverContext[] = [];

  constructor(private readonly script: AgentOperation[]) {}

  decide(context: DriverContext): AgentOperation {
    this.contexts.push(context);
    return this.script.shift() ?? { kind: 'fail', reason: '脚本耗尽' };
  }
}

/** 异步决策 driver(Phase E:LLM driver 的 decide 是异步的,循环须 await)。 */
export class AsyncScriptedDriver implements AgentDriver {
  constructor(private readonly script: AgentOperation[]) {}

  decide(context: DriverContext): Promise<AgentOperation> {
    void context; // 与 ScriptedDriver 对齐:刻意不读上下文
    return Promise.resolve(this.script.shift() ?? { kind: 'fail', reason: '脚本耗尽' });
  }
}

export interface TransportOptions {
  entities?: Record<string, SirenEntity>;
  execResponses?: Response[];
  /** 在场时按 /.well-known/ui4a.json 响应(缺省 404,等价端点缺失)。 */
  sitemap?: unknown;
}

/** 契同路由:GET sitemap/entity 查表;POST /api/exec 依次出队。 */
export function contractTransport(options: TransportOptions = {}) {
  const entities = options.entities ?? {};
  const execResponses = [...(options.execResponses ?? [])];
  return createScriptedTransport((url, init) => {
    if (init?.method === 'POST' || url === execUrl(BASE)) {
      const response = execResponses.shift();
      if (response !== undefined) return response;
      return jsonResponse({ error: '脚本耗尽:无更多 exec 响应' }, 500);
    }
    if (options.sitemap !== undefined && url.endsWith('/.well-known/ui4a.json')) {
      return jsonResponse(options.sitemap);
    }
    const rel = new URL(url).searchParams.get('rel') ?? '';
    const entity = entities[rel];
    if (entity !== undefined) return jsonResponse(entity);
    return jsonResponse({ error: `实体 "${rel}" 不存在` }, 404);
  });
}
