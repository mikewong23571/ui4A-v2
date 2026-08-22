import type { SirenEntity } from '@ui4a/engine';

/** href → rel 参数(/api/entity?rel=post%3Ax → post:x)。 */
export function relFromHref(href: string | undefined): string | undefined {
  if (href === undefined) return undefined;
  const match = /[?&]rel=([^&]+)/.exec(href);
  return match === null ? undefined : decodeURIComponent(match[1]!);
}

/** 实体上可导航的 rel 候选(links 的 rel= 与子实体)，排除当前 rel，保序去重。 */
export function navigableRels(entity: SirenEntity, currentRel: string): string[] {
  const candidates: string[] = [];
  const push = (rel: string | undefined): void => {
    if (rel === undefined || rel === '' || rel === currentRel) return;
    if (!candidates.includes(rel)) candidates.push(rel);
  };
  for (const link of entity.links) push(relFromHref(link.href));
  for (const sub of entity.entities ?? []) {
    const rel = sub.properties.rel;
    push(typeof rel === 'string' ? rel : relFromHref(sub.href));
  }
  return candidates;
}
