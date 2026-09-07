import type { SirenEntity, SirenFieldPresentation } from '@ui4a/engine';

export function semanticsOf(entity: SirenEntity) {
  const source = entity.properties.presentation;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined;
  return source as { version?: unknown; traits?: unknown; groupRole?: unknown; fields?: unknown };
}

export function hasTrait(entity: SirenEntity, trait: string): boolean {
  const semantics = semanticsOf(entity);
  return (
    semantics?.version === 1 && Array.isArray(semantics.traits) && semantics.traits.includes(trait)
  );
}

export function splitWorkMembers(entities: readonly SirenEntity[]) {
  const work = new Map<string, SirenEntity>();
  const materials = new Map<string, SirenEntity>();
  const responsibilities = new Map<string, SirenEntity>();
  function visit(members: readonly SirenEntity[], supporting = false) {
    for (const member of members) {
      const semantics = semanticsOf(member);
      const group =
        semantics?.version === 1 &&
        typeof semantics.groupRole === 'string' &&
        member.entities !== undefined;
      const contextual = supporting || hasTrait(member, 'supporting-context');
      const rel = member.properties.rel;
      if (typeof rel === 'string' && rel !== '') {
        if (!group && hasTrait(member, 'human-responsibility')) responsibilities.set(rel, member);
        else if (contextual) materials.set(rel, member);
        else work.set(rel, member);
      }
      visit(member.entities ?? [], contextual);
    }
  }
  visit(entities);
  for (const rel of responsibilities.keys()) {
    work.delete(rel);
    materials.delete(rel);
  }
  for (const rel of work.keys()) materials.delete(rel);
  return {
    work: [...work.values()],
    materials: [...materials.values()],
    responsibilities: [...responsibilities.values()],
  };
}

export function declaredContent(entity: SirenEntity) {
  const fields = semanticsOf(entity)?.fields;
  if (!Array.isArray(fields)) return [];
  return fields
    .flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const field = entry as SirenFieldPresentation;
      if (
        typeof field.path !== 'string' ||
        typeof field.title !== 'string' ||
        (field.role !== 'primary-content' && field.role !== 'metadata')
      )
        return [];
      let value: unknown = entity;
      for (const key of field.path.split('.')) {
        value =
          typeof value === 'object' && value !== null && !Array.isArray(value)
            ? (value as Record<string, unknown>)[key]
            : undefined;
      }
      if (value === undefined || value === null || value === '') return [];
      return [{ ...field, value }];
    })
    .sort((a, b) => Number(a.role === 'metadata') - Number(b.role === 'metadata'));
}
