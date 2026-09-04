import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from './args.js';
import { runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { CliError, failure } from './envelope.js';
import { Ui4aHttpClient } from './http.js';

// T52 Phase 4 CLI 门:应用停用(deprecate)的三门同门语义合同钉测。
// 编排裁定(US6):CLI 是 agent 通道——合同可达(GET meta 实体 actions 数组
// 含 deprecate,P3 投影镜像)+ 送达 /_meta/api/exec + 引擎 actor-is-human
// guard 的结构化诚实拒绝(I4:与浏览器人通道同一裁决器、同一拒绝语义);
// 执行属于人通道,CLI 的角色是审计回读。
//
// 选 A(无客户端 human-only 特判):与 approve/reject 的客户端预拒绝先例
// (commands-business.ts)不同——那是"agent 不得裁决人类的确认决定"这一
// 架构铁律的客户端防线;deprecate 是生命周期动作,human-only 性声明在
// 合同(guards)里,由同一引擎 judge 裁决,引擎拒绝是唯一权威(D71),
// CLI 照实呈现结构化理由。本文件全部为现状钉测,不引入新行为。

const REL = 'meta/application:publishing';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** P3 投影镜像:active 应用的 meta 实体带 deprecate 动作(可选 reason 字段)。 */
function activeApplicationEntity(): Record<string, unknown> {
  return {
    class: ['meta', 'application-definition'],
    properties: { rel: REL, name: 'publishing', title: 'Publishing', status: 'active' },
    actions: [
      {
        name: 'deprecate',
        title: '停用',
        href: '/_meta/api/exec',
        method: 'POST',
        fields: {
          type: 'object',
          properties: { reason: { type: 'string', title: '停用理由' } },
        },
      },
    ],
    links: [],
  };
}

/** 引擎 guard 拒绝体(judge.ts 口径:layer + reason + 可选 detail;HTTP 422)。 */
function actorIsHumanRejection(): Record<string, unknown> {
  return {
    layer: 'guard-failed',
    reason: 'guard 不满足: actor-is-human=false',
    detail: {
      guards: [
        { name: 'actor-is-human', pass: false },
        { name: 'application-not-default', pass: true },
      ],
    },
  };
}

describe('T52 CLI application deprecation gate (agent channel)', () => {
  it('surfaces the declared deprecate action from the meta entity projection', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      urls.push(String(input));
      return response(activeApplicationEntity());
    });
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal' },
    );
    const result = await runCommand(
      parseArgs(['actions', 'list', REL]),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe('actions.list');
    expect(urls).toEqual([
      // 本地 demo(无凭证、未声明 lens):meta 读经 policyScope 查询参数。
      'https://ui4a.internal/_meta/api/entity?rel=meta%2Fapplication%3Apublishing&policyScope=publishing',
    ]);
    const rows = result.data as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'deprecate', title: '停用' });
  });

  it('posts the deprecate exec to /_meta/api/exec with credential-derived identity stripped', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({
        url: String(input),
        ...(init?.method === 'POST'
          ? { body: JSON.parse(String(init.body)) as Record<string, unknown> }
          : {}),
      });
      // GET → 原样 Siren 实体;POST 的 200 应答只是让调用完成以捕获请求
      // 形状,agent 通道的真实应答(guard 拒绝)由下一条测试单独钉住。
      return response(
        init?.method === 'POST' ? { entity: activeApplicationEntity() } : activeApplicationEntity(),
      );
    });
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: 'opaque-token' },
    );
    const result = await runCommand(
      parseArgs(['actions', 'exec', REL, 'deprecate', '--params', '{"reason":"走查残留清理"}']),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe('actions.exec');
    expect(calls.map((call) => call.url)).toEqual([
      'https://ui4a.internal/_meta/api/entity?rel=meta%2Fapplication%3Apublishing&scope=development',
      'https://ui4a.internal/_meta/api/exec?scope=development',
    ]);
    // token 模式:剥离 actor/principal/channel——身份由服务端从 device 凭证
    // 派生(agent),不接受请求侧身份覆盖。
    expect(calls[1]!.body).toEqual({
      rel: REL,
      action: 'deprecate',
      params: { reason: '走查残留清理' },
    });
  });

  it('self-reports the explicit agent identity and empty params when no reason is given', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return response({ entity: activeApplicationEntity() });
      }
      return response(activeApplicationEntity());
    });
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal' },
    );
    const result = await runCommand(
      parseArgs(['actions', 'exec', REL, 'deprecate']),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result.ok).toBe(true);
    // 无 token:显式自报 agent 身份;reason 可选——未提供时 params 为空对象。
    expect(bodies[0]).toEqual({
      rel: REL,
      action: 'deprecate',
      params: {},
      actor: 'agent',
      principal: expect.any(String),
      channel: 'cli',
    });
  });

  it('delivers the agent write to the engine and surfaces the guard rejection verbatim (same gate as the human channel)', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      urls.push(url);
      // exec 前 GET 实体(动作声明可见)→ POST 收到引擎 422 guard 拒绝。
      return init?.method === 'POST'
        ? response(actorIsHumanRejection(), 422)
        : response(activeApplicationEntity());
    });
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: 'opaque-token' },
    );
    const caught = await runCommand(
      parseArgs(['actions', 'exec', REL, 'deprecate', '--params', '{"reason":"cleanup"}']),
      new Ui4aHttpClient(config, fetcher),
    ).catch((error: unknown) => error);

    // 选 A 钉测:写离开 CLI(无客户端 human-only 预拒绝),同一引擎裁决。
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(urls[1]).toBe('https://ui4a.internal/_meta/api/exec');
    expect(caught).toBeInstanceOf(CliError);
    expect(caught).toMatchObject({
      code: 'JUDGMENT',
      exitCode: 6,
      status: 422,
      message: 'guard 不满足: actor-is-human=false',
      details: { layer: 'guard-failed' },
      retryable: false,
    });
    // 失败回执口径(main.ts 打印的 envelope):不静默、结构化、携带引擎理由
    // 与 detail,退出码 6 —— agent 收到与浏览器人通道同源的诚实拒绝。
    const output = failure('actions.exec', caught as CliError);
    expect(output).toMatchObject({
      ok: false,
      command: 'actions.exec',
      error: {
        code: 'JUDGMENT',
        message: expect.stringContaining('actor-is-human=false'),
        status: 422,
        retryable: false,
      },
    });
    expect(JSON.stringify(output)).toContain('guard-failed');
  });

  it('passes a 202 suspension through verbatim (no CLI confirmation flow today)', async () => {
    const suspended = {
      status: 'suspended',
      confirmation: {
        rel: 'confirmation:application-deprecate-1',
        subject: REL,
        action: 'deprecate',
        level: 'high',
      },
    };
    const fetcher = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'POST' ? response(suspended, 202) : response(activeApplicationEntity()),
    );
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: 'opaque-token' },
    );
    const result = await runCommand(
      parseArgs(['actions', 'exec', REL, 'deprecate']),
      new Ui4aHttpClient(config, fetcher),
    );

    // 现状钉住:202 属 2xx 成功段,CLI 以 success envelope 原样透传挂起体,
    // 不解析、不新开确认流(CLI 无 approve 是架构约束;确认裁决属人通道)。
    // 严策略下这是人通道的理论路径;agent 通道实际先被 guard 拒(见上)。
    expect(result.ok).toBe(true);
    expect(result.command).toBe('actions.exec');
    expect(result.data).toEqual(suspended);
  });

  it('reads the application-deprecated audit trail verbatim after a human-channel deprecation', async () => {
    const urls: string[] = [];
    const events = [
      {
        seq: 11,
        ts: '2026-09-04T00:00:00.000Z',
        kind: 'action-executed',
        rel: REL,
        action: 'deprecate',
        actor: 'human',
        principal: 'user:mike',
        channel: 'bios',
      },
      {
        seq: 12,
        ts: '2026-09-04T00:00:00.001Z',
        kind: 'application-deprecated',
        rel: REL,
        action: 'deprecate',
        actor: 'human',
        principal: 'user:mike',
        channel: 'bios',
        detail: {
          name: 'publishing',
          reason: '走查残留清理',
          commandId: 'application-deprecate:publishing',
        },
      },
    ];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      urls.push(String(input));
      return response({ events, page: { nextAfterSeq: 12, hasMore: false } });
    });
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: 'opaque-token' },
    );
    const result = await runCommand(
      parseArgs(['audit', 'entity', REL]),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe('audit.entity');
    expect(urls).toEqual([
      'https://ui4a.internal/api/events?rel=meta%2Fapplication%3Apublishing&afterSeq=0&limit=20',
    ]);
    // CLI 无事件 kind 展示表:events 原样透传进 envelope(kind/detail 全文
    // 人类可读),application-deprecated 无需在客户端登记。
    expect(result.data).toEqual(events);
    expect(result.page).toEqual({ nextCursor: 12, hasMore: false });
    expect(JSON.stringify(result)).toContain('application-deprecated');
    expect(JSON.stringify(result)).toContain('application-deprecate:publishing');
  });
});
