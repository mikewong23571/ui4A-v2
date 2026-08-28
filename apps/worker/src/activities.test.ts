import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';

import type { DbExecutor } from '@ui4a/db/events';

import {
  deliverNotification,
  materializeCapabilityArtifact,
  specializationAdapterForTask,
} from './activities';
import type { AgentRunWorkflowArgs } from './agents/host/contracts';
import type { NotifyConfirmation } from './workflows';

// notify activity 单测(T3 Phase C / Task 1,TDD 红→绿):
// 核心纯逻辑 deliverNotification 直接注入假 db(不触 PG/Temporal):
// - 事件写入形状:notification-delivered、rel=confirmation:<id>、channel=notify,
//   detail 含 inbox 条目数据(notificationId=notif:<id> + 确认摘要);
// - 幂等:同 id 的 notification-delivered 已存在 → 不双写(deduplicated=true)。
// 真实 PG + 真 Temporal 链路由 web 侧集成测试覆盖(service.notify.integration.test.ts)。
const confirmation: NotifyConfirmation = {
  id: 'c1',
  targetRel: 'post:post-welcome',
  targetAction: 'archive',
  proposedBy: { actor: 'agent', principal: 'user:mike' },
  reason: 'Cedar: high 风险动作且 actor=agent,需人类确认',
};

/**
 * 最小假 db:按 SQL 前缀分流——
 * - `SELECT seq FROM events`(activity 的幂等存在性检查)→ existingSeq 决定命中;
 * - `INSERT INTO events`(appendEvent)→ 记录参数并返回 seq=7;
 * - 其余(ensureEventsTable 的 DDL)→ 空结果放行。
 */
function fakeDb(existingSeq: number | null): {
  db: DbExecutor;
  inserts: { sqlText: string; values: readonly unknown[] }[];
} {
  const inserts: { sqlText: string; values: readonly unknown[] }[] = [];
  const db: DbExecutor = {
    async query<R extends QueryResultRow = QueryResultRow>(
      sqlText: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      if (sqlText.startsWith('SELECT seq FROM events')) {
        return {
          rows: existingSeq === null ? [] : [{ seq: String(existingSeq) }],
          rowCount: existingSeq === null ? 0 : 1,
        } as unknown as QueryResult<R>;
      }
      if (sqlText.startsWith('INSERT INTO events')) {
        inserts.push({ sqlText, values: values ?? [] });
        return {
          rows: [{ seq: '7', ts: new Date('2026-08-21T00:00:00Z') }],
        } as unknown as QueryResult<R>;
      }
      // 其余(ensureEventsTable 的 DDL)→ 空结果放行。
      // 断言理由:假 db 只需满足 DbExecutor 的最小形状,QueryResult 其余字段缺省。
      return { rows: [], rowCount: 0 } as unknown as QueryResult<R>;
    },
  };
  return { db, inserts };
}

describe('deliverNotification(事件写入形状)', () => {
  it('appendEvent 写 notification-delivered:rel=confirmation:<id>,channel=notify,detail 含 notif:<id> 与确认摘要', async () => {
    const { db, inserts } = fakeDb(null);

    const result = await deliverNotification(db, confirmation);

    expect(result).toEqual({ seq: 7, deduplicated: false });
    expect(inserts).toHaveLength(1);
    // appendEvent 的 INSERT 列序:actor, principal, channel, kind, rel, action, params, reason, detail。
    const values = inserts[0]!.values;
    expect(values[3]).toBe('notification-delivered');
    expect(values[4]).toBe('confirmation:c1');
    expect(values[0]).toBe('agent');
    expect(values[1]).toBe('user:mike');
    expect(values[2]).toBe('notify');
    // detail = inbox 条目数据:notificationId 去重键 + 确认摘要(Phase D 收件箱渲染输入)。
    expect(JSON.parse(String(values[8]))).toEqual({
      notificationId: 'notif:c1',
      confirmation: {
        id: 'c1',
        targetRel: 'post:post-welcome',
        targetAction: 'archive',
        proposedBy: { actor: 'agent', principal: 'user:mike' },
        reason: 'Cedar: high 风险动作且 actor=agent,需人类确认',
      },
    });
  });
});

describe('deliverNotification(幂等)', () => {
  it('同 id 的 notification-delivered 已存在 → 不双写,deduplicated=true', async () => {
    const { db, inserts } = fakeDb(6);

    const result = await deliverNotification(db, confirmation);

    expect(result).toEqual({ seq: 6, deduplicated: true });
    expect(inserts).toHaveLength(0);
  });

  it('不同 id 互不影响(存在性检查按 rel 精确匹配)', async () => {
    const { db, inserts } = fakeDb(null);
    await deliverNotification(db, { ...confirmation, id: 'c2' });
    expect(inserts).toHaveLength(1);
    expect(JSON.parse(String(inserts[0]!.values[8]))).toMatchObject({ notificationId: 'notif:c2' });
  });
});

describe('materializeCapabilityArtifact(正式模型工件)', () => {
  it('worker 只落 capability artifact 事件，携带完整 provenance 并计算内容 hash', async () => {
    const { db, inserts } = fakeDb(null);
    const result = await materializeCapabilityArtifact(db, {
      id: 'summary-a1',
      capability: 'summarize',
      source: { rel: 'post:first-post', field: 'body' },
      model: 'stub-summary-model',
      outputSchema: { type: 'object', required: ['summary'] },
      content: { summary: '正式摘要' },
      createdBy: { actor: 'agent', principal: 'user:mike' },
    });

    expect(result).toMatchObject({ seq: 7, deduplicated: false });
    expect(result.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    const values = inserts[0]!.values;
    expect(values[3]).toBe('capability-artifact-created');
    expect(values[4]).toBe('artifact:summary-a1');
    expect(JSON.parse(String(values[8]))).toEqual({
      id: 'summary-a1',
      capability: 'summarize',
      source: { rel: 'post:first-post', field: 'body' },
      model: 'stub-summary-model',
      outputSchema: { type: 'object', required: ['summary'] },
      content: { summary: '正式摘要' },
      contentHash: result.contentHash,
      createdBy: { actor: 'agent', principal: 'user:mike' },
    });
  });

  it('同 artifact id 重试不重复写', async () => {
    const { db, inserts } = fakeDb(6);
    const result = await materializeCapabilityArtifact(db, {
      id: 'summary-a1',
      capability: 'summarize',
      source: { rel: 'post:first-post', field: 'body' },
      model: 'stub',
      outputSchema: { type: 'object' },
      content: { summary: '正式摘要' },
      createdBy: { actor: 'agent' },
    });
    expect(result).toMatchObject({ seq: 6, deduplicated: true });
    expect(inserts).toHaveLength(0);
  });
});

describe('generic Agent Host specialization selector', () => {
  const context = (kind: string): AgentRunWorkflowArgs =>
    ({
      task: { payload: { kind } },
    }) as unknown as AgentRunWorkflowArgs;

  it('selects coding and Writing adapters by server-compiled task kind', () => {
    expect(specializationAdapterForTask(context('coding-task'))).toBe('coding');
    expect(specializationAdapterForTask(context('writing-task'))).toBe('writing');
    expect(specializationAdapterForTask(context('agent-definition-authoring-task'))).toBe(
      'authoring',
    );
    expect(() => specializationAdapterForTask(context('research-task'))).toThrow(
      /no Agent specialization adapter/i,
    );
  });
});
