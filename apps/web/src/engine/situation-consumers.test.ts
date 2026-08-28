import { beforeEach, describe, expect, it } from 'vitest';

import type { AgentRunBirthReferences, AgentRunCommand } from '@ui4a/engine';
import {
  CHAT_VIEW_PROTOCOL_VERSION,
  parseClientViewReport,
  type ClientViewReport,
} from '@ui4a/shared';

import { GET } from '../app/api/entity/route';
import { resolveTrustedRequestIdentity } from '../auth/request-identity';
import { appendAgentRunCommand, ensureAgentRunTables } from '@ui4a/db/agent-runs';
import { ensureEventsTable } from '@ui4a/db/events';
import { appendPresenceChange, ensurePresenceTables } from '@ui4a/db/presence';
import { getPool } from '@ui4a/db/pool';
import { situationForChat } from './chat-situation';
import { getDb, getEngine, resetEngineForTests } from './service';

// T31 R3(←T29):消费方矩阵从源码文本断言改为行为测试,兑现 T29 plan 承诺
// "改一处 presence → 两处行为同变"。
// - fixture:appendPresenceChange 写入可辨识 presence 投影(site/scope 各一条);
// - chat 消费方:situationForChat 真实调用(与 /api/chat 同一函数接线),identity 经
//   resolveTrustedRequestIdentity 本地方案构造(授予集合 = 服务端已安装应用全集,
//   D51);
// - Agent Run 读模型经真实 GET /api/entity handler 断言授予并集口径(D51):集合
//   按 principal 返回全部自有 Run,不再随会话 lens 过滤;
// - 授权纪律:fixture scope 只取服务端已安装 Application 的授权集内值(动态取自
//   快照,不钉死词表);越权场景留给 Phase C(R9/R10)。site 断言用 fixture 值等式,
//   不钉死 site 词表(T27 改名中)。
const pool = getPool(process.env.DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a');
const PRINCIPAL = 'user:situation-matrix';

function entityRequest(query: string): Request {
  return new Request(`http://localhost:3100/api/entity${query}`, {
    headers: { 'x-ui4a-principal': PRINCIPAL },
  });
}

async function writePresence(site: string, scope: string): Promise<void> {
  const identity = { principal: PRINCIPAL, actor: 'human' as const, channel: 'test' };
  await appendPresenceChange(pool, { schemaVersion: 1, kind: 'site', value: site }, identity);
  await appendPresenceChange(pool, { schemaVersion: 1, kind: 'scope', value: scope }, identity);
}

async function installedScopes(): Promise<string[]> {
  const engine = await getEngine(getDb());
  return Object.keys(engine.getSnapshot().applications ?? {}).sort();
}

/** 与 /api/chat 本地接线同构的 identity(授予集合来自服务端已安装应用,D51)。 */
async function chatSituation() {
  const identity = await resolveTrustedRequestIdentity(
    new Request('http://localhost:3100/api/chat', { headers: { 'x-ui4a-principal': PRINCIPAL } }),
    {
      plane: 'business',
      requiredScopes: ['ui4a:read'],
      authorizedPolicyScopes: await installedScopes(),
    },
  );
  return situationForChat({ principal: PRINCIPAL, identity });
}

interface RunsCollection {
  status: number;
  count?: number;
  ids: string[];
}

/** 经真实 GET /api/entity 读 agent-runs 集合(按派生 policyScope 过滤的读模型)。 */
async function agentRunsCollection(): Promise<RunsCollection> {
  const response = await GET(entityRequest('?rel=agent-runs'));
  const body = (await response.json()) as {
    properties?: { count?: number };
    entities?: { properties: { id: string } }[];
  };
  return {
    status: response.status,
    count: body.properties?.count,
    ids: (body.entities ?? []).map((child) => child.properties.id),
  };
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensurePresenceTables(pool);
  await ensureAgentRunTables(pool);
  await pool.query(
    `TRUNCATE events, presence_current, agent_run_projection_state, agent_run_projection,
     agent_run_payloads`,
  );
  resetEngineForTests();
  // 先在干净事件日志上完成一次应用装配引导(懒触发),再注入 presence/capability 域事件。
  expect((await GET(entityRequest('?rel=nope'))).status).toBe(404);
});

describe('T29 situation consumer matrix (behavioral)', () => {
  it('one presence write moves the chat plane and its disclosure slice together', async () => {
    // 授权集内的两个 Application scope 动态取自快照。
    const [scopeA, scopeB] = await installedScopes();
    expect(scopeA).toBeDefined();
    expect(scopeB).toBeDefined();

    // 状态 A:同一次 presence 投影喂出 chat 处境与其披露切片的一致事实。
    await writePresence('desk-alpha', scopeA);
    const chatA = await chatSituation();
    expect(chatA.site).toBe('desk-alpha');
    expect(chatA.scope).toBe(scopeA);
    expect(chatA.disclosure).toEqual({
      scope: chatA.scope,
      thread: chatA.thread,
      focus: chatA.focus,
    });

    // 状态 B:只改一处(presence 投影),处境与披露切片同向变化。
    await writePresence('desk-beta', scopeB);
    const chatB = await chatSituation();
    expect(chatB.site).toBe('desk-beta');
    expect(chatB.scope).toBe(scopeB);
    expect(chatB.disclosure.scope).toBe(chatB.scope);
  });

  it('agent-run read model returns all principal-owned runs regardless of lens (D51)', async () => {
    const [scopeA, scopeB] = await installedScopes();
    await appendAgentRunCommand(pool, createRun('matrix-run-a', scopeA));
    await appendAgentRunCommand(pool, createRun('matrix-run-b', scopeB));

    await writePresence('desk-beta', scopeB);
    const runs = await agentRunsCollection();
    expect(runs.status).toBe(200);
    // HTTP 合同按授予并集返回本人名下全部 Run;lens 只影响披露切片与落点。
    expect(runs.count).toBe(2);
    expect([...runs.ids].sort()).toEqual(['matrix-run-a', 'matrix-run-b']);
  });

  it('clientView ingress keeps the retired route-bearing wire shape absent (auxiliary freeze)', () => {
    // 辅助冻结(替代原 readFileSync 正则扫描):主要保障是上方消费方行为测试;
    // 此处只在协议形状层加一道锁——结构满足现行 ClientViewReport,且旧携带
    // route 字段的 presence 形状在共享解析入口被 exact-keys 拒绝(GR2 单实现)。
    const report = {
      schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
      presence: {
        clientInstanceId: 'client-1',
        site: 'site-value-any',
        scope: null,
        thread: null,
        focus: null,
      },
    } satisfies ClientViewReport;
    expect(report.presence.clientInstanceId).toBe('client-1');
    expect(() =>
      parseClientViewReport({
        schemaVersion: CHAT_VIEW_PROTOCOL_VERSION,
        presence: { ...report.presence, route: '/threads/current' },
      }),
    ).toThrowError(/forbidden key route/);
  });
});

const birth: AgentRunBirthReferences = {
  schemaVersion: 1,
  kind: 'event-native',
  definition: {
    ref: 'situation-matrix-agent@1',
    version: 1,
    sourceHash: 'sha256:source',
    parentHashes: [],
    flattenedHash: 'sha256:flattened',
  },
  prompt: { templateHash: 'sha256:template', compiledHash: 'sha256:compiled' },
  runtime: { profileName: 'matrix-default', profileVersion: '1', adapterVersion: 'host-v1' },
  taskContract: { ref: 'matrix-task@1', hash: 'sha256:task' },
  resultContract: { ref: 'matrix-result@1', hash: 'sha256:result' },
};

function createRun(
  runId: string,
  policyScope: string,
): Extract<AgentRunCommand, { kind: 'create' }> {
  return {
    kind: 'create',
    eventId: `event:create:${runId}`,
    commandId: `command:create:${runId}`,
    runId,
    principal: PRINCIPAL,
    policyScope,
    source: {
      rel: 'situation-matrix-request:main',
      action: 'draft',
      eventId: `event:src:${runId}`,
    },
    birth,
    task: { schemaVersion: 1, contract: birth.taskContract, payload: {} },
  };
}
