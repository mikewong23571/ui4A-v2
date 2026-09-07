import type { DbExecutor } from '@ui4a/db/events';
import type { SirenEntity } from '@ui4a/engine';
import { getMessageEntities, isMessageRel } from '../message-entity';

/** Read-time composition only: callers prune thread ownership and application grants first. */
export async function enrichEntityWithMessages(
  db: DbExecutor,
  entity: SirenEntity,
  principal: string,
  readMode: 'required' | 'committed-receipt' = 'required',
): Promise<SirenEntity> {
  const references: string[] = [];
  const collect = (entry: SirenEntity): void => {
    const rel = entry.properties.rel;
    if (entry.class.includes('thread-reference') && typeof rel === 'string' && isMessageRel(rel)) {
      references.push(rel);
    }
    entry.entities?.forEach(collect);
  };
  collect(entity);
  if (references.length === 0) return entity;
  let messages: Map<string, SirenEntity>;
  let readFailed = false;
  try {
    messages = await getMessageEntities(db, references, principal);
  } catch (error) {
    // The mutation is already durable. An optional read cannot revoke its accepted receipt.
    if (readMode !== 'committed-receipt') throw error;
    messages = new Map();
    readFailed = true;
  }
  const requested = new Set(references);
  const compose = (entry: SirenEntity): SirenEntity => {
    const rel = entry.properties.rel;
    const member =
      entry.class.includes('thread-reference') && typeof rel === 'string' && requested.has(rel);
    const message = typeof rel === 'string' ? messages.get(rel) : undefined;
    const properties = { ...entry.properties };
    if (member) {
      delete properties.status;
      delete properties.statusText;
      properties.identity = message?.properties.identity ?? '无法读取的消息';
      if (message === undefined)
        properties.statusText = readFailed ? '暂时无法读取此材料' : '无法读取此材料';
    }
    for (const category of ['active', 'approval']) {
      const pointers = properties[category];
      if (Array.isArray(pointers))
        properties[category] = pointers.map((pointer: unknown) => {
          if (
            typeof pointer !== 'object' ||
            pointer === null ||
            !('rel' in pointer) ||
            typeof pointer.rel !== 'string' ||
            !requested.has(pointer.rel)
          )
            return pointer;
          if (readFailed) return { rel: pointer.rel };
          return messages.has(pointer.rel) ? { rel: pointer.rel, dangling: false } : pointer;
        });
    }
    return {
      ...entry,
      class: member
        ? [
            ...entry.class.filter((kind) => kind !== 'dangling'),
            ...(message === undefined ? ['unavailable'] : []),
          ]
        : entry.class,
      properties,
      links: entry.links.map((link) => {
        const target = new URL(link.href, 'https://ui4a.invalid').searchParams.get('rel');
        if (target === null || !requested.has(target)) return link;
        return {
          ...link,
          title: String(messages.get(target)?.properties.identity ?? '无法读取的消息'),
          rel: [
            ...link.rel.filter((kind) => kind !== 'dangling'),
            ...(messages.has(target) ? [] : ['unavailable']),
          ],
        };
      }),
      ...(entry.entities === undefined ? {} : { entities: entry.entities.map(compose) }),
    };
  };
  return compose(entity);
}
