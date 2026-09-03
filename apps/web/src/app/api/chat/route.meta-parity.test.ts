import { type Server, createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureDraftTables } from '@ui4a/db/drafts';
import { ensureEventsTable, listEvents } from '@ui4a/db/events';

import { POST as postMetaExecRoute } from '../meta/exec/route';
import {
  chat,
  entityRequestRels,
  metaEntityRequestRels,
  metaExecRequestBodies,
  metaExecRequestUrls,
  metaSitemapRequestCount,
  pool,
  sitemapRequestCount,
  startChatRouteFixtures,
  stopChatRouteFixtures,
} from './route-test-kit';

// T48 Phase 6b(US6):Chat 同门协议测试(注入驱动,零真实 LLM)。
// 参考 Assistant 在 meta 站提议创建 application 时,读面与写面都落在与 CLI
// 相同的 meta 合同门(canonical /_meta/*,next.config.ts 重写至 /api/meta/*):
// - 发现/读取:chat 循环经 /_meta/.well-known/ui4a.json 与 /_meta/api/entity
//   读到与 CLI 相同的 meta/drafts Siren 合同(create 动作含 application-bundle
//   kind;commandId 为客户端持有字段,不在模型可填参数中);
// - 执行:exec POST 落在 /_meta/api/exec(CLI 同一裁决端点),载荷形状与 CLI
//   完全一致(rel/action/params/actor=agent/principal/channel=chat);
// - 无 lens 边界(如实固定):Draft 写要求显式授权 application lens
//   (request-identity 只认 ?policyScope=/?scope= 查询参数或
//   x-ui4a-policy-scope 头)。clientView 未声明 scope 时,同一 create 提案在
//   同一门被结构化拒绝(422 schema-invalid),不产生 Draft——拒绝即数据(I6)。
// - 显式 lens 通道(D66 附录,Phase 6b-2):situation 带显式 scope(显式 >
//   presence,单点装配)时,chat route 对 meta 平面的 exec 请求附加
//   ?scope=<lens>(模型工具 schema 不含 scope 参数,注意力不来自模型发明);
//   授予集合外的声明仍由服务端现有逻辑丢弃/拒绝。同一 create 全链成功:
//   draft-created 落库(owner=user:<session>,provenance actor=agent)。

const SESSION_ID = 'us6-meta-parity';
const LENS_SESSION_ID = 'us6-lens-channel';
const GOAL_VERB = '请提议安装一个新 application:chat-genesis';
const LENS_GOAL_VERB = '请提议安装一个新 application:chat-genesis-lens';
const TARGET = 'chat-genesis';
const LENS_TARGET = 'chat-genesis-lens';
const LENS = 'publishing';

/** meta 控制台在场(clientView presence.site='meta'):chat route 把合同站切到 /_meta。
 * scope 为显式声明的 attention lens(D66 附录);null = 未声明(无 lens 边界)。 */
function metaConsoleView(scope: string | null = null) {
  return {
    schemaVersion: 2 as const,
    presence: {
      clientInstanceId: 'client:us6-meta-parity',
      site: 'meta',
      scope,
      thread: null,
      focus: null,
    },
  };
}

/** 合法 application-bundle 提案载荷(与 engine/drafts/application-bundle.test.ts 同形)。 */
function bundlePayload(name: string): Record<string, unknown> {
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name, version: 1 },
    applications: [{ name, title: 'Chat Genesis', intent: 'Assistant 在 chat 中提议的受治理安装' }],
    capabilities: [],
    flows: [
      {
        name: `${name}-entry`,
        title: 'Chat entry',
        app: name,
        initial: 'start',
        nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
        fields: [],
      },
    ],
    seed: { rel: `seed:${name}`, detail: { instances: {} } },
  };
}

/**
 * 记录型 LLM 桩(SSE 流式;route-test-kit 同口径):按序返回注入的协议操作,
 * 同时捕获每次 driver 决策请求原文(证明模型看到的是合同工具投影)。
 */
function createRecordingLlmStub(
  operations: { name: string; args: Record<string, unknown> }[],
): Promise<Server & { port(): number; driverCalls: unknown[] }> {
  return new Promise((resolve) => {
    let calls = 0;
    const driverCalls: unknown[] = [];
    const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) =>
      `data: ${JSON.stringify({
        id: 'chatcmpl-t48-us6',
        object: 'chat.completion.chunk',
        created: 1755700000,
        model: 'test-model',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}`;
    const stub = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const piece of req) chunks.push(Buffer.from(piece));
      try {
        driverCalls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        driverCalls.push({});
      }
      const operation = operations[Math.min(calls, operations.length - 1)]!;
      calls += 1;
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.end(
        `${[
          chunk({
            tool_calls: [
              {
                index: 0,
                id: `call_us6_${calls}`,
                type: 'function',
                function: { name: operation.name, arguments: JSON.stringify(operation.args) },
              },
            ],
          }),
          chunk({}, 'tool_calls'),
          'data: [DONE]',
        ].join('\n\n')}\n\n`,
      );
    }) as Server & { port(): number; driverCalls: unknown[] };
    stub.port = () => (stub.address() as { port: number }).port;
    stub.driverCalls = driverCalls;
    stub.listen(0, '127.0.0.1', () => resolve(stub));
  });
}

/** 注入的 Assistant 提案决策序列:读取 meta 合同 → 提交 application-bundle 提案 → 据实收尾。 */
function proposalOperations(): { name: string; args: Record<string, unknown> }[] {
  return [
    { name: 'navigate', args: { rel: 'meta/drafts' } },
    {
      name: 'exec',
      args: {
        action: 'create',
        params: { kind: 'application-bundle', target: TARGET, payload: bundlePayload(TARGET) },
        authorization: { sourceMessageId: 'route-test-turn', quote: GOAL_VERB },
      },
    },
    {
      name: 'fail',
      args: {
        reason: 'Draft 写要求显式授权 application lens,chat 合同没有该声明通道',
        evidence: [
          'meta/drafts create 被拒:Draft action requires an explicit authorized application lens',
        ],
      },
    },
  ];
}

/** 从捕获的 driver 请求里取指定工具的参数 schema(宽容解析 AI SDK 的 tools 载体)。 */
function toolParametersOf(driverCall: unknown, toolName: string): Record<string, unknown> {
  const tools = (driverCall as { tools?: unknown[] }).tools ?? [];
  for (const tool of tools) {
    const fn = (tool as { function?: { name?: string; parameters?: unknown } }).function;
    if (fn?.name === toolName) {
      const parameters = fn.parameters;
      if (parameters !== undefined && typeof parameters === 'object' && parameters !== null) {
        return parameters as Record<string, unknown>;
      }
    }
  }
  return {};
}

beforeEach(startChatRouteFixtures);
afterEach(stopChatRouteFixtures);

describe('T48 US6:chat Assistant 与 CLI 的 meta Draft 同门(meta 站注入驱动)', () => {
  const envKey = process.env.LLM_API_KEY;
  const envBase = process.env.LLM_BASE_URL;
  const envModel = process.env.LLM_MODEL;
  let stub: (Server & { port(): number; driverCalls: unknown[] }) | undefined;

  beforeEach(async () => {
    await ensureDraftTables(pool);
    await ensureEventsTable(pool);
    await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  });

  afterEach(async () => {
    if (envKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = envKey;
    if (envBase === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = envBase;
    if (envModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = envModel;
    if (stub !== undefined) await new Promise<void>((resolve) => stub!.close(() => resolve()));
    stub = undefined;
  });

  async function useStub(operations: { name: string; args: Record<string, unknown> }[]) {
    stub = await createRecordingLlmStub(operations);
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stub.port()}/v4`;
    process.env.LLM_MODEL = 'test-model';
  }

  it('读面同门:chat 循环读 /_meta 合同,create 工具即 CLI 所见同一动作(application-bundle kind)', async () => {
    await useStub([
      { name: 'navigate', args: { rel: 'meta/drafts' } },
      { name: 'done', args: { summary: '已读取 Draft 合同' } },
    ]);

    const { json } = await chat({
      sessionId: SESSION_ID,
      goal: { verb: GOAL_VERB },
      clientView: metaConsoleView(),
    });

    expect(json.outcome, JSON.stringify(json.messages)).toBe('done');
    // 合同站整体落在 /_meta:meta sitemap 被读取,业务 sitemap/entity 零请求。
    expect(metaSitemapRequestCount()).toBeGreaterThanOrEqual(1);
    expect(sitemapRequestCount()).toBe(0);
    expect(entityRequestRels()).toEqual([]);
    // 起步 meta/applications(meta 站兜底),导航后读取 meta/drafts 集合。
    expect(metaEntityRequestRels()[0]).toBe('meta/applications');
    expect(metaEntityRequestRels()).toContain('meta/drafts');

    // 第二次决策发生在 meta/drafts 上:模型工具面出现 action_create,与 CLI
    // 读到的同一动作字段一致——kind 枚举含 application-bundle;commandId 是
    // 客户端持有字段(不进模型参数);lens 不是动作参数(只能在请求级声明)。
    const createParameters = toolParametersOf(stub?.driverCalls[1], 'action_create');
    expect(createParameters).not.toEqual({});
    const properties = (createParameters.properties ?? {}) as Record<string, unknown>;
    expect((properties.kind as { enum?: string[] }).enum).toContain('application-bundle');
    expect(properties.commandId).toBeUndefined();
    expect(properties.policyScope).toBeUndefined();
  });

  it('写面同门与当前边界:exec 落在 /_meta/api/exec 同一裁决端点;缺显式 lens 被结构化拒绝且不产生 Draft;同一载荷补 lens 后经同一裁决路径创建 Draft', async () => {
    await useStub(proposalOperations());

    const { json } = await chat({
      sessionId: SESSION_ID,
      goal: { verb: GOAL_VERB },
      clientView: metaConsoleView(),
    });

    // 注入的第三步 fail:Assistant 如实报告合同拒绝(不假装成功)。
    expect(json.outcome, JSON.stringify(json.messages)).toBe('failed');
    expect((json.messages ?? []).map((message) => message.text).join('\n')).toContain(
      '被拒 create(meta/drafts)',
    );

    // exec 恰好一次,落在 CLI 同一 canonical 门 /_meta/api/exec,载荷形状与
    // CLI 完全一致;commandId 由客户端持有注入(UUID),不由模型编造。
    const execBodies = metaExecRequestBodies();
    expect(execBodies).toHaveLength(1);
    const execBody = execBodies[0]!;
    const commandId = (execBody.params as { commandId?: string }).commandId;
    expect(execBody).toMatchObject({
      rel: 'meta/drafts',
      action: 'create',
      actor: 'agent',
      principal: `user:${SESSION_ID}`,
      channel: 'chat',
      authorization: { sourceMessageId: 'route-test-turn', quote: GOAL_VERB },
    });
    expect((execBody.params as { kind?: string }).kind).toBe('application-bundle');
    expect((execBody.params as { target?: string }).target).toBe(TARGET);
    expect(commandId).toMatch(/^[0-9a-f-]{36}$/);

    // 轨迹留痕:结构化拒绝(schema-invalid 层 + lens 原因),拒绝即数据(I6)。
    const rejectedStep = (json.steps as unknown[]).find(
      (step) =>
        (step as { op?: { kind?: string; action?: string } }).op?.kind === 'exec' &&
        (step as { op?: { action?: string } }).op?.action === 'create' &&
        (step as { outcome?: string }).outcome === 'rejected',
    ) as { rejection?: { layer?: string; reason?: string } } | undefined;
    expect(rejectedStep?.rejection?.layer).toBe('schema-invalid');
    expect(rejectedStep?.rejection?.reason).toContain('explicit authorized application lens');

    // 拒绝是裁决结果,不是静默失败:事件日志中没有任何 Draft 出生。
    expect(await listEvents(pool, 0, { domain: 'draft', kind: 'draft-created' })).toEqual([]);

    // 同门证明(裁决路径一致,缺口仅在 lens 声明通道):把 chat 发出的同一份
    // 载荷逐字重放至同一 /_meta/api/exec 处理器,仅补 CLI 通道的显式 lens 头
    // (x-ui4a-policy-scope)→ 同一裁决路径接受,产出 Draft 实体回执。
    const replay = await postMetaExecRoute(
      new Request('http://localhost:3100/_meta/api/exec', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ui4a-policy-scope': LENS },
        body: JSON.stringify(execBody),
      }),
    );
    expect(replay.status).toBe(200);
    const receipt = (await replay.json()) as {
      entity: {
        properties: {
          rel: string;
          kind: string;
          target: string;
          schemaRef: string;
          provenance: { actor: string; principal: string; commandId: string };
        };
      };
    };
    expect(receipt.entity.properties.rel).toMatch(/^draft:/);
    expect(receipt.entity.properties).toMatchObject({
      kind: 'application-bundle',
      target: TARGET,
      schemaRef: 'ui4a://application-bundle/v1',
    });
    // 提案归属:agent 作者 + chat principal + 客户端注入的 commandId(T17 精神:
    // agent 候选进入 Draft,人类才可激活)。
    expect(receipt.entity.properties.provenance).toMatchObject({
      actor: 'agent',
      principal: `user:${SESSION_ID}`,
      commandId,
    });
    expect(await listEvents(pool, 0, { domain: 'draft', kind: 'draft-created' })).toHaveLength(1);
  });

  it('显式 lens 通道(D66 附录):situation 显式 scope 由服务端注入 ?scope=,create(application-bundle) 全链成功', async () => {
    await useStub([
      { name: 'navigate', args: { rel: 'meta/drafts' } },
      {
        name: 'exec',
        args: {
          action: 'create',
          params: {
            kind: 'application-bundle',
            target: LENS_TARGET,
            payload: bundlePayload(LENS_TARGET),
          },
          authorization: { sourceMessageId: 'route-test-turn', quote: LENS_GOAL_VERB },
        },
      },
      { name: 'done', args: { summary: '已提交 application-bundle 提案,Draft 等待人类裁决' } },
    ]);

    const { json } = await chat({
      sessionId: LENS_SESSION_ID,
      goal: { verb: LENS_GOAL_VERB },
      clientView: metaConsoleView(LENS),
    });

    expect(json.outcome, JSON.stringify(json.messages)).toBe('done');

    // 注入点证明:exec 恰好一次,URL 落在 CLI 同一门 /_meta/api/exec 且携带
    // 服务端注入的 ?scope=publishing(lens 来自 situation 单点装配的显式声明,
    // 不是模型参数);POST 体形状与 CLI 一致且零 scope 键(传输声明,非载荷)。
    const urls = metaExecRequestUrls();
    expect(urls).toHaveLength(1);
    const execUrl = new URL(urls[0]!);
    expect(execUrl.pathname).toBe('/_meta/api/exec');
    expect(execUrl.searchParams.get('scope')).toBe(LENS);
    const execBody = metaExecRequestBodies()[0]!;
    expect(execBody).not.toHaveProperty('scope');
    expect((execBody.params as { kind?: string }).kind).toBe('application-bundle');
    expect((execBody.params as { target?: string }).target).toBe(LENS_TARGET);

    // 全链成功:Draft 出生落库——owner=user:<session>(事件 principal),
    // provenance actor=agent(事件 actor 列来自 version.provenance.actor)。
    const draftEvents = await listEvents(pool, 0, { domain: 'draft', kind: 'draft-created' });
    expect(draftEvents).toHaveLength(1);
    expect(draftEvents[0]).toMatchObject({
      actor: 'agent',
      principal: `user:${LENS_SESSION_ID}`,
      rel: expect.any(String),
    });
    expect(draftEvents[0]!.rel).toMatch(/^draft:/);

    // 实体回执:exec 成功步的实体摘要指向 draft:* 合同投影。
    const executedStep = (json.steps as unknown[]).find(
      (step) =>
        (step as { op?: { kind?: string } }).op?.kind === 'exec' &&
        (step as { outcome?: string }).outcome === 'executed',
    ) as { entity?: { rel?: string } } | undefined;
    expect(executedStep?.entity?.rel).toMatch(/^draft:/);
  });
});
