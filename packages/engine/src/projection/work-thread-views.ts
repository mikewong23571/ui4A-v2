import type { EngineSnapshot } from '@ui4a/shared';
import type { ProjectDeps, SirenEntity } from '../contract/siren/types';
import { entityHref } from '../contract/siren/build';
import { projectCognitiveSemantics } from '../contract/cognitive-semantics';
import {
  projectWorkThreads,
  THREAD_CURRENT_REL,
  THREAD_HISTORY_REL,
  THREADS_REL,
} from './work-thread';

/** Read-only lifecycle slices of the canonical collection; ownership filtering remains at HTTP. */
export function projectWorkThreadView(
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
  rel: typeof THREAD_CURRENT_REL | typeof THREAD_HISTORY_REL,
): SirenEntity {
  const current = rel === THREAD_CURRENT_REL;
  const source = projectWorkThreads(snapshot, deps);
  const states = current ? ['open', 'paused'] : ['completed', 'archived'];
  const entities =
    source.entities?.filter((member) => states.includes(String(member.properties.status))) ?? [];
  const title = current ? '继续工作' : '已结束的工作';
  return {
    ...source,
    properties: {
      rel,
      title,
      count: entities.length,
      presentation: projectCognitiveSemantics({
        declaration: {
          version: 1,
          traits: current ? ['work-queue'] : ['task-history'],
          emptyMeaning: current ? 'ready-to-start' : 'no-results',
        },
        fieldPresentations: [{ path: 'properties.title', title: '标题', role: 'identity' }],
      }),
    },
    actions: [],
    'guard-results': [],
    entities,
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, rel), title },
      {
        rel: ['collection'],
        href: entityHref(deps.baseHref, THREADS_REL),
        title: '全部工作线与新建',
      },
    ],
  };
}
