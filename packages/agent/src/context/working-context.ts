import type { SirenEntity } from '@ui4a/engine';

import type { ContractClient } from '../contract/http';
import type { ContractObservation } from '../types';

export const MAX_WORKING_CONTEXT_REFERENCES = 4;
const REFERENCE_CATEGORIES = ['context', 'active', 'approval'] as const;

export interface WorkingContextReference {
  rel: string;
  categories: (typeof REFERENCE_CATEGORIES)[number][];
}

/** Ephemeral, authorized facts for one decision. Only the root rel is durable. */
export interface WorkingContext {
  rel: string;
  entity?: SirenEntity;
  observations: ContractObservation[];
  references: WorkingContextReference[];
  unavailable: boolean;
  truncated: number;
}

function categoryReferences(entity: SirenEntity): WorkingContextReference[] {
  const references = new Map<string, WorkingContextReference>();
  for (const link of entity.links) {
    const categories = REFERENCE_CATEGORIES.filter((category) => link.rel.includes(category));
    if (categories.length === 0) continue;
    let rel: string | null;
    try {
      rel = new URL(link.href, 'https://contract.invalid').searchParams.get('rel');
    } catch {
      continue;
    }
    if (rel === null || rel === '' || rel === entity.properties.rel) continue;
    const existing = references.get(rel);
    references.set(rel, {
      rel,
      categories: [...new Set([...(existing?.categories ?? []), ...categories])],
    });
  }
  return [...references.values()];
}

/** Read a fresh work-thread contract and at most four direct, explicitly linked resources. */
export async function loadWorkingContext(
  client: Pick<ContractClient, 'getEntity'>,
  contextRel: string | undefined,
  currentEntity?: SirenEntity,
): Promise<WorkingContext | undefined> {
  if (contextRel === undefined) return undefined;
  const entity =
    currentEntity?.properties.rel === contextRel
      ? currentEntity
      : (await client.getEntity(contextRel)).entity;
  if (entity === undefined || !entity.class.includes('work-thread')) {
    return {
      rel: contextRel,
      observations: [],
      references: [],
      unavailable: true,
      truncated: 0,
    };
  }
  const allReferences = categoryReferences(entity);
  const references = allReferences.slice(0, MAX_WORKING_CONTEXT_REFERENCES);
  const observations: ContractObservation[] = [];
  for (const reference of references) {
    const related =
      currentEntity?.properties.rel === reference.rel
        ? currentEntity
        : (await client.getEntity(reference.rel)).entity;
    if (related !== undefined) observations.push({ rel: reference.rel, entity: related });
  }
  return {
    rel: contextRel,
    entity,
    references,
    observations,
    unavailable: false,
    truncated: allReferences.length - references.length,
  };
}
