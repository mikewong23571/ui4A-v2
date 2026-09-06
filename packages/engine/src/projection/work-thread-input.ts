import type { EngineSnapshot } from '@ui4a/shared';
import { entityHref } from '../contract/siren/build';
import type { ProjectDeps, SirenEntity } from '../contract/siren/types';

export const THREAD_INPUT_REL_PREFIX = 'thread-input:';
export function threadInputRel(id: string): string {
  return `${THREAD_INPUT_REL_PREFIX}${id}`;
}

/** A read-only view of the immutable input in the same thread-created event, never new state. */
export function projectThreadInput(
  snapshot: EngineSnapshot,
  rel: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  const id = rel.slice(THREAD_INPUT_REL_PREFIX.length);
  const thread = Object.hasOwn(snapshot.threads ?? {}, id) ? snapshot.threads?.[id] : undefined;
  if (thread === undefined || thread.goal.source !== rel) return undefined;
  return {
    class: ['work-thread-input'],
    properties: {
      rel,
      owner: thread.owner,
      text: thread.goal.text,
      presentation: {
        fields: [{ path: 'properties.text', title: '创建时的目标原文', role: 'primary-content' }],
      },
    },
    actions: [],
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, rel) },
      { rel: ['up'], href: entityHref(deps.baseHref, `thread:${thread.id}`), title: '返回工作线' },
    ],
  };
}
