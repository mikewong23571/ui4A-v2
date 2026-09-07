import type { SirenEntity } from '../contract/siren/types';
import { THREAD_ARCHIVE_ACTION, THREAD_DETACH_ACTION } from './work-thread';

/** Thread lifecycle declaration: archived has no outgoing actions; references are not deleted. */
export const THREAD_ARCHIVE_DESCRIPTION =
  '归档后，这条工作线将不再提供恢复或其他操作。已关联的对象保留。';

interface ReferenceOption {
  title: string;
  params: { category: string; rel: string };
}

/** Read only the already authorized projection. Never derive choices from an unfiltered snapshot. */
export function projectThreadActionExperience(entity: SirenEntity): SirenEntity {
  const entities = entity.entities?.map(projectThreadActionExperience);
  if (!entity.class.includes('work-thread')) {
    return entities === undefined ? entity : { ...entity, entities };
  }
  const options: ReferenceOption[] = (entities ?? []).flatMap((member) => {
    const { rel, identity, category } = member.properties;
    if (
      !member.class.includes('thread-reference') ||
      typeof rel !== 'string' ||
      (category !== 'context' && category !== 'active' && category !== 'approval')
    )
      return [];
    return [{ title: typeof identity === 'string' ? identity : rel, params: { category, rel } }];
  });
  for (const link of entity.links) {
    if (!link.rel.includes('event')) continue;
    const query = link.href.split('?')[1];
    if (query === undefined) continue;
    const raw = new URLSearchParams(query).get('afterSeq');
    if (raw === null || raw === '') continue;
    const sequence = Number(raw) + 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1) continue;
    options.push({
      title: link.title ?? `事件 ${sequence}`,
      params: { category: 'event', rel: `event:${sequence}` },
    });
  }
  return {
    ...entity,
    ...(entities === undefined ? {} : { entities }),
    actions: entity.actions.map((action) =>
      action.name === THREAD_DETACH_ACTION.name
        ? {
            ...action,
            fields: {
              ...action.fields,
              'x-ui4a-reference-selection': { effect: 'unlink', options },
            },
          }
        : action.name === THREAD_ARCHIVE_ACTION.name
          ? { ...action, fields: { ...action.fields, description: THREAD_ARCHIVE_DESCRIPTION } }
          : action,
    ),
  };
}
