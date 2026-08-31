import type { EngineSnapshot } from '@ui4a/shared';

import { projectCognitiveSemantics } from '../cognitive-semantics';
import { entityHref } from './build';
import type { ProjectDeps, SirenEntity, SirenLink } from './types';

const APPLICATION_PREFIX = 'application:';

/** Neutral discovery root; membership derives from active business Application definitions. */
export function projectApplications(snapshot: EngineSnapshot, deps: ProjectDeps): SirenEntity {
  const entities = Object.values(snapshot.applications ?? {}).flatMap((application) => {
    if (application.cognitive?.traits?.includes('system-fallback')) return [];
    const rel = `${APPLICATION_PREFIX}${application.name}`;
    const entity = projectApplication(snapshot, rel, deps);
    return entity === undefined
      ? []
      : [{ ...entity, rel: ['item'], href: entityHref(deps.baseHref, rel) }];
  });
  return {
    class: ['collection', 'applications'],
    properties: { rel: 'applications', title: '应用', count: entities.length },
    entities,
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'applications') }],
    actions: [],
    'guard-results': [],
  };
}

/** Read-only Business-plane projection of one active Application definition. */
export function projectApplication(
  snapshot: EngineSnapshot,
  rel: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  if (!rel.startsWith(APPLICATION_PREFIX)) return undefined;
  const name = rel.slice(APPLICATION_PREFIX.length);
  const application = snapshot.applications?.[name];
  if (application === undefined) return undefined;

  const presentation = projectCognitiveSemantics({ declaration: application.cognitive });
  const links: SirenLink[] = [{ rel: ['self'], href: entityHref(deps.baseHref, rel) }];
  if (application.entry !== undefined) {
    links.push({ rel: ['entry'], href: entityHref(deps.baseHref, application.entry.target) });
  }

  return {
    class: ['application'],
    properties: {
      rel,
      name: application.name,
      title: application.title,
      intent: application.intent,
      ...(application.entry === undefined ? {} : { entry: application.entry }),
      ...(presentation === undefined ? {} : { presentation }),
    },
    actions: [],
    links,
    'guard-results': [],
  };
}
