/**
 * G14(T54):`message:<id>` principal 受约束只读投影——工作线消息引用可解引用,
 * 跨 principal 与缺失同形 404(D51),零动作面。纯单测:DbExecutor 以最小
 * query 桩注入(listEvents 的 SQL 过滤语义由 events 套件覆盖)。
 */
import { describe, expect, it, vi } from 'vitest';

import { getMessageEntity, isMessageRel } from './message-entity';

interface Row {
  seq: number;
  ts: Date;
  domain: string;
  actor: string;
  principal: string;
  channel: string;
  kind: string;
  rel: string;
  action: string;
  params: unknown;
  reason: unknown;
  detail: unknown;
}

function row(principal: string, messageId: string, content: string): Row {
  return {
    seq: 1,
    ts: new Date(0),
    domain: 'core',
    actor: 'human',
    principal,
    channel: 'chat',
    kind: 'chat-message-appended',
    rel: 'chat:s1',
    action: 'say',
    params: undefined,
    reason: undefined,
    detail: {
      sessionId: 's1',
      turnId: 't1',
      messageId,
      role: 'user',
      content,
      provenance: { kind: 'user-input' },
    },
  };
}

function dbOf(rows: Row[]) {
  return {
    // 模拟 listEvents 的 SQL 语义:principal 过滤下推(参数化值命中行)。
    query: vi.fn(async (_sql: string, values: unknown[]) => ({
      rows: rows.filter((r) => values.includes(r.principal)) as unknown[],
    })),
  };
}

describe('message:<id> read-only projection (G14)', () => {
  it('同 principal 按 messageId 解析:身份摘要+全文+会话定位,零动作面', async () => {
    const db = dbOf([row('user:mike', 'm-42', '这条消息是工作材料')]);
    const entity = await getMessageEntity(db as never, 'message:m-42', 'user:mike');
    expect(entity).toMatchObject({
      class: ['message', 'user'],
      properties: {
        rel: 'message:m-42',
        identity: '这条消息是工作材料',
        role: 'user',
        sessionId: 's1',
        turnId: 't1',
        content: '这条消息是工作材料',
      },
      actions: [],
    });
    expect(entity?.links[0]?.href).toBe('/api/entity?rel=message%3Am-42');
    // principal 过滤下推到查询(SQL 参数含 principal)。
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('跨 principal 与缺失同形 undefined(存在性不泄露);长文身份摘要截断', async () => {
    const long = '他人会话内容不应可见。'.repeat(30);
    const db = dbOf([row('user:other', 'm-43', long)]);
    expect(await getMessageEntity(db as never, 'message:m-43', 'user:mike')).toBeUndefined();
    expect(await getMessageEntity(dbOf([]) as never, 'message:never', 'user:mike')).toBeUndefined();
    const own = await getMessageEntity(db as never, 'message:m-43', 'user:other');
    expect(own).toBeDefined();
    expect((own!.properties.identity as string).length).toBeLessThanOrEqual(80);
  });

  it('rel 判定只认 message: 前缀;空 id 与缺 content 诚实 undefined', async () => {
    expect(isMessageRel('message:m-1')).toBe(true);
    expect(isMessageRel('messages:m-1')).toBe(false);
    expect(isMessageRel('meta/application:x')).toBe(false);
    expect(await getMessageEntity(dbOf([]) as never, 'message:', 'user:mike')).toBeUndefined();
    const broken = dbOf([{ ...row('user:mike', 'm-45', 'x'), detail: { messageId: 'm-45' } }]);
    expect(
      await getMessageEntity(broken as never, 'message:m-45', 'user:mike'),
    ).toBeUndefined();
  });
});
