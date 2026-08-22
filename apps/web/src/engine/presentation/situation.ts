import {
  resolveAuthorizedContractGraph,
  type ContractGraphAuthorizationRequest,
  type ContractGraphEdgeReference,
  type SemanticRegionRole,
  type SirenEntity,
} from '@ui4a/engine';
import type { RenderSituation } from '@ui4a/shared';

export interface SirenSituationDependencies {
  authorize(request: ContractGraphAuthorizationRequest): boolean | Promise<boolean>;
  fetch(rel: string): SirenEntity | undefined | Promise<SirenEntity | undefined>;
}

export interface ResolvedSirenSituation {
  graph: Awaited<ReturnType<typeof resolveAuthorizedContractGraph<SirenEntity>>>;
  /** Private, sanitized hydration map; never serialized into a public receipt or Chat history. */
  entities: Map<string, SirenEntity>;
}

export interface PresentationSubtreeKeys {
  shell: string;
  current?: string;
  children: string[];
}

const SEMANTIC_ROLES = new Set<SemanticRegionRole>([
  'identity',
  'status',
  'primary-content',
  'metadata',
  'relation',
  'actions',
  'diagnostic',
]);

function entityRel(entity: SirenEntity): string | undefined {
  const rel = entity.properties.rel;
  return typeof rel === 'string' && rel !== '' ? rel : undefined;
}

function hrefRel(href: string): string | undefined {
  try {
    const parsed = new URL(href, 'http://ui4a.local');
    return parsed.searchParams.get('rel') ?? undefined;
  } catch {
    return undefined;
  }
}

function edgesOf(entity: SirenEntity): ContractGraphEdgeReference[] {
  const members = (entity.entities ?? []).flatMap((member) => {
    const targetRel = entityRel(member);
    return targetRel === undefined ? [] : [{ kind: 'member' as const, targetRel }];
  });
  const relations = entity.links.flatMap((link) => {
    const relation = link.rel[0];
    const targetRel = hrefRel(link.href);
    if (relation === undefined || relation === 'self' || targetRel === undefined) return [];
    return [{ kind: 'relation' as const, relation, targetRel }];
  });
  return [...members, ...relations];
}

function sanitizeEntities(
  fetched: ReadonlyMap<string, SirenEntity>,
  graph: ResolvedSirenSituation['graph'],
): Map<string, SirenEntity> {
  const authorized = new Set(graph.nodes.map(({ rel }) => rel));
  const targetsBySource = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const targets = targetsBySource.get(edge.sourceRel) ?? new Set<string>();
    targets.add(edge.targetRel);
    targetsBySource.set(edge.sourceRel, targets);
  }
  const result = new Map<string, SirenEntity>();
  for (const [rel, entity] of fetched) {
    if (!authorized.has(rel)) continue;
    const targets = targetsBySource.get(rel) ?? new Set<string>();
    const entities = (entity.entities ?? []).filter((member) => {
      const childRel = entityRel(member);
      return childRel !== undefined && targets.has(childRel) && authorized.has(childRel);
    });
    const links = entity.links.filter((link) => {
      if (link.rel.includes('self')) return true;
      const targetRel = hrefRel(link.href);
      return targetRel !== undefined && targets.has(targetRel) && authorized.has(targetRel);
    });
    result.set(rel, {
      ...entity,
      properties: {
        ...entity.properties,
        ...(entity.entities === undefined ? {} : { count: entities.length }),
      },
      links,
      ...(entity.entities === undefined ? {} : { entities }),
    });
  }
  return result;
}

/** Resolve through the pure authorization kernel, retaining facts only in a sanitized private map. */
export async function buildSirenSituation(
  situation: RenderSituation,
  dependencies: SirenSituationDependencies,
): Promise<ResolvedSirenSituation> {
  const fetched = new Map<string, SirenEntity>();
  const graph = await resolveAuthorizedContractGraph(situation, {
    authorize: dependencies.authorize,
    fetch: async (rel) => {
      const entity = await dependencies.fetch(rel);
      if (entity !== undefined) fetched.set(rel, entity);
      return entity;
    },
    enumerateEdges: ({ value }) => edgesOf(value),
  });
  return { graph, entities: sanitizeEntities(fetched, graph) };
}

/** Read declaration-only semantic hints; values remain in the Siren entity for runtime deref. */
export function semanticHintsOf(entity: SirenEntity): Record<string, SemanticRegionRole> {
  const presentation = entity.properties.presentation;
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) {
    return {};
  }
  const fields = (presentation as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return {};
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (typeof field !== 'object' || field === null || Array.isArray(field)) return [];
      const { path, role } = field as Record<string, unknown>;
      return typeof path === 'string' && SEMANTIC_ROLES.has(role as SemanticRegionRole)
        ? [[path, role as SemanticRegionRole] as const]
        : [];
    }),
  );
}

/** Stable structural keys; values/membership never participate in a shell identity. */
export function subtreeKeysOf(
  entity: SirenEntity,
  intent: string,
  definitionVersion: string,
): PresentationSubtreeKeys {
  const rel = entityRel(entity) ?? 'unknown';
  const flow = entity.properties.flow;
  const node = entity.properties.node;
  if (typeof flow === 'string' && typeof node === 'string') {
    const base = `flow:${encodeURIComponent(flow)}:${definitionVersion}:${encodeURIComponent(intent)}`;
    return {
      shell: `${base}:shell`,
      current: `${base}:node:${encodeURIComponent(node)}`,
      children: [`${base}:context`, `${base}:output`, `${base}:history`],
    };
  }
  if (entity.entities !== undefined) {
    const base = `collection:${encodeURIComponent(rel)}:${definitionVersion}:${encodeURIComponent(intent)}`;
    return {
      shell: `${base}:shell`,
      children: entity.entities.flatMap((member) => {
        const memberRel = entityRel(member);
        return memberRel === undefined ? [] : [`${base}:item:${encodeURIComponent(memberRel)}`];
      }),
    };
  }
  return {
    shell: `entity:${encodeURIComponent(rel)}:${definitionVersion}:${encodeURIComponent(intent)}`,
    children: [],
  };
}
