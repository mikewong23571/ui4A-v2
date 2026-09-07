import type { EntityCacheHandle } from '../../../entity-cache-provider';
import { hrefToRel } from '../../../contract-href';
import { withPolicyScope } from '../../../exec-client';
import {
  collapseSharedFallbackLabel,
  firstString,
  selectorCandidateLabel,
} from '../thread-desk-shared';

export interface SelectorCandidate {
  rel: string;
  identity: string;
  labelDeclared: boolean;
  status?: string;
  sources: string[];
}

/** Only authorized collection members become candidates; one row per canonical reference. */
export async function discoverCandidates(cache: EntityCacheHandle) {
  const response = await fetch(withPolicyScope('/.well-known/ui4a.json', undefined));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as {
    surfaces?: Array<{ rel?: unknown; title?: unknown; collection?: unknown }>;
  };
  const collections = (body.surfaces ?? []).filter(
    (surface): surface is { rel: string; title?: string } =>
      surface.collection === true && typeof surface.rel === 'string',
  );
  const candidates = new Map<string, SelectorCandidate>();
  let unavailable = false;
  for (const collection of collections) {
    const entity = await cache.get(collection.rel).catch(() => null);
    if (entity === null) {
      unavailable = true;
      continue;
    }
    const source = firstString(entity.properties.title, collection.title) ?? collection.rel;
    const members = (entity.entities ?? []).flatMap((member) => {
      const rel =
        firstString(member.properties.rel) ??
        member.links
          .filter((link) => link.rel.includes('self'))
          .map((link) => hrefToRel(link.href))
          .find((ref) => ref !== null);
      if (!rel) return [];
      const label = selectorCandidateLabel(member);
      return [
        {
          rel,
          identity: label?.text ?? rel,
          labelDeclared: label?.declared ?? false,
          status: firstString(member.properties.statusText, member.properties.title),
          sources: [source],
        },
      ];
    });
    for (const member of collapseSharedFallbackLabel(members)) {
      const previous = candidates.get(member.rel);
      if (previous) {
        if (!previous.sources.includes(source)) previous.sources.push(source);
      } else candidates.set(member.rel, member);
    }
  }
  return { candidates: [...candidates.values()], unavailable };
}
