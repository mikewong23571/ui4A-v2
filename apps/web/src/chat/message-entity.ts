/**
 * G14(T54):`message:<id>` 的 principal 受约束只读投影。
 *
 * Chat 消息经 attachChatMessageToThread 以 `message:<messageId>` 挂入工作线
 * (category=context);消息是合法工作材料,但没有实体读取面——引用不可解
 * 引用(A26)。本模块把 canonical `chat-message-appended` 事件按 messageId
 * 解析为最小 Siren 实体:仅同 principal 可见(跨 principal 与缺失同形 404,
 * D51 存在性隐藏);全文与 sessionId/turnId 如实携带(定位回会话),零动作面
 * (消息不可 exec,操作回工作线/会话)。
 */
import { listEvents } from '@ui4a/db/events';
import type { DbExecutor } from '@ui4a/db/events';
import type { SirenEntity } from '@ui4a/engine';

export function isMessageRel(rel: string): boolean {
  return rel.startsWith('message:');
}

function excerpt(content: string): string {
  const flattened = content.replace(/\s+/gu, ' ').trim();
  return flattened.length > 80 ? `${flattened.slice(0, 79)}…` : flattened;
}

interface MessageAppendedShape {
  sessionId?: unknown;
  turnId?: unknown;
  messageId?: unknown;
  role?: unknown;
  content?: unknown;
}

/**
 * 按 messageId 解析当前 principal 的消息实体;未命中(不存在/他者)→ undefined
 * (调用方按 404 呈现,不区分两种原因)。
 */
export async function getMessageEntity(
  db: DbExecutor,
  rel: string,
  principal: string,
): Promise<SirenEntity | undefined> {
  return (await getMessageEntities(db, [rel], principal)).get(rel);
}

/** One principal-scoped log read for all requested references, with no retained message store. */
export async function getMessageEntities(
  db: DbExecutor,
  rels: readonly string[],
  principal: string,
): Promise<Map<string, SirenEntity>> {
  const requested = new Set(rels.filter((rel) => isMessageRel(rel) && rel !== 'message:'));
  const entities = new Map<string, SirenEntity>();
  if (requested.size === 0) return entities;
  const events = await listEvents(db, 0, { kind: 'chat-message-appended', principal });
  for (const event of events) {
    const detail = event.detail as MessageAppendedShape | undefined;
    if (typeof detail?.messageId !== 'string' || detail.messageId === '') continue;
    const rel = `message:${detail.messageId}`;
    if (!requested.has(rel) || entities.has(rel)) continue;
    if (typeof detail?.content !== 'string') continue;
    entities.set(rel, {
      class: ['message', typeof detail.role === 'string' ? detail.role : 'unknown'],
      properties: {
        rel,
        identity: excerpt(detail.content),
        ...(typeof detail.role === 'string' ? { role: detail.role } : {}),
        ...(typeof detail.sessionId === 'string' ? { sessionId: detail.sessionId } : {}),
        ...(typeof detail.turnId === 'string' ? { turnId: detail.turnId } : {}),
        content: detail.content,
      },
      actions: [],
      links: [{ rel: ['self'], href: `/api/entity?rel=${encodeURIComponent(rel)}` }],
    });
  }
  return entities;
}
