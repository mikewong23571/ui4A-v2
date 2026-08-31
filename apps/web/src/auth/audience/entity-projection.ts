import type { SirenEntity } from '@ui4a/engine';

export function relFromHref(href: string | undefined): string | undefined {
  if (href === undefined) return undefined;
  try {
    return new URL(href, 'https://ui4a.invalid').searchParams.get('rel') ?? undefined;
  } catch {
    return undefined;
  }
}

export function entityRel(entity: SirenEntity): string | undefined {
  return (
    relFromHref(entity.href) ??
    relFromHref(entity.links.find((link) => link.rel.includes('self'))?.href) ??
    (typeof entity.properties.rel === 'string' ? entity.properties.rel : undefined)
  );
}

interface ProjectionReadRules {
  readable: (rel: string) => boolean;
  referenceHolder: (entity: SirenEntity) => boolean;
  sourceRel: (rel: string) => string;
}

function referenceRel(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const rel = (value as { rel?: unknown }).rel;
  return typeof rel === 'string' ? rel : undefined;
}

function referenceProperties(entity: SirenEntity, rules: ProjectionReadRules) {
  const properties = { ...entity.properties };
  const firstActive = Array.isArray(properties.active)
    ? referenceRel(properties.active[0])
    : undefined;
  for (const key of ['context', 'active', 'approval']) {
    const value = properties[key];
    if (Array.isArray(value))
      properties[key] = value.filter((item) => {
        const rel = referenceRel(item);
        return rel === undefined || rules.readable(rel);
      });
  }
  // Resume is display text derived from the original first active reference, never a rel.
  if (firstActive !== undefined && !rules.readable(firstActive)) delete properties.resume;
  const goal = properties.goal;
  if (typeof goal === 'object' && goal !== null && !Array.isArray(goal)) {
    const source = (goal as { source?: unknown }).source;
    if (typeof source === 'string' && !rules.readable(rules.sourceRel(source))) {
      const safeGoal = { ...(goal as Record<string, unknown>) };
      delete safeGoal.source;
      properties.goal = safeGoal;
      delete properties.goalSourceText;
    }
  }
  return properties;
}

/** Apply the same reference judgments at every embedded level without mutating source facts. */
export function filterEntityTree(entity: SirenEntity, rules: ProjectionReadRules): SirenEntity {
  const entities = entity.entities
    ?.filter((child) => {
      const rel = entityRel(child);
      return rel === undefined || rules.readable(rel);
    })
    .map((child) => filterEntityTree(child, rules));
  const properties = rules.referenceHolder(entity)
    ? referenceProperties(entity, rules)
    : entity.properties;
  return {
    ...entity,
    properties:
      entities !== undefined && typeof properties.count === 'number'
        ? { ...properties, count: entities.length }
        : properties,
    links: entity.links.filter((link) => {
      const rel = relFromHref(link.href);
      return rel === undefined || rules.readable(rel);
    }),
    ...(entities === undefined ? {} : { entities }),
  };
}
