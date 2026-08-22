import { parseRenderSituation, type DataLens, type RenderSituation } from '@ui4a/shared';

type Awaitable<T> = T | Promise<T>;
type FlowLensPart = Extract<DataLens, { kind: 'flow' }>['include'][number];

export type ContractGraphEdgeReference =
  | { kind: 'member'; targetRel: string }
  | { kind: 'relation'; relation: string; targetRel: string }
  | { kind: 'flow'; part: FlowLensPart; targetRel: string };

export type AuthorizedContractGraphEdge = ContractGraphEdgeReference & { sourceRel: string };

export interface AuthorizedContractGraphNode {
  rel: string;
  depth: number;
}

export interface ContractGraphFetchedNode<TEntity> extends AuthorizedContractGraphNode {
  /** Private adapter input. Fetched facts are deliberately absent from the resolver result. */
  value: TEntity;
}

export type ContractGraphTruncationReason = 'max-depth' | 'max-nodes';

/**
 * A receipt intentionally identifies only the already-authorized source and edge selector. It never
 * carries an omitted target or count, because either would disclose data outside the resolved Lens.
 */
export type ContractGraphTruncationReceipt =
  | {
      sourceRel: string;
      reason: ContractGraphTruncationReason;
      kind: 'member';
    }
  | {
      sourceRel: string;
      reason: ContractGraphTruncationReason;
      kind: 'relation';
      relation: string;
    }
  | {
      sourceRel: string;
      reason: ContractGraphTruncationReason;
      kind: 'flow';
      part: FlowLensPart;
    };

export interface AuthorizedContractGraph {
  roots: string[];
  nodes: AuthorizedContractGraphNode[];
  edges: AuthorizedContractGraphEdge[];
  truncations: ContractGraphTruncationReceipt[];
}

export type ContractGraphAuthorizationRequest =
  | {
      kind: 'root';
      targetRel: string;
      audience: RenderSituation['audience'];
    }
  | {
      kind: 'edge';
      sourceRel: string;
      targetRel: string;
      edge: ContractGraphEdgeReference;
      audience: RenderSituation['audience'];
    };

export interface ContractGraphResolverDependencies<TEntity> {
  /** Authorization runs before every root fetch and before following every selected edge. */
  authorize(request: ContractGraphAuthorizationRequest): Awaitable<boolean>;
  /** Returns the current authorized contract projection. Missing entities fail closed. */
  fetch(rel: string): Awaitable<TEntity | undefined>;
  /** Extracts contract-declared edges from a fetched entity without performing I/O. */
  enumerateEdges(node: ContractGraphFetchedNode<TEntity>): readonly ContractGraphEdgeReference[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isFlowPart(value: unknown): value is FlowLensPart {
  return (
    value === 'current-node' || value === 'context' || value === 'outputs' || value === 'history'
  );
}

/** Fail closed on malformed adapter output rather than reflecting it into a receipt or Surface. */
function normalizeEdgeReference(value: unknown): ContractGraphEdgeReference | undefined {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!isNonEmptyString(candidate.targetRel)) return undefined;
  if (candidate.kind === 'member') {
    return { kind: 'member', targetRel: candidate.targetRel };
  }
  if (candidate.kind === 'relation' && isNonEmptyString(candidate.relation)) {
    return {
      kind: 'relation',
      relation: candidate.relation,
      targetRel: candidate.targetRel,
    };
  }
  if (candidate.kind === 'flow' && isFlowPart(candidate.part)) {
    return { kind: 'flow', part: candidate.part, targetRel: candidate.targetRel };
  }
  return undefined;
}

function edgeSelected(lens: DataLens, edge: ContractGraphEdgeReference): boolean {
  switch (lens.kind) {
    case 'self':
    case 'selection':
      return false;
    case 'members':
      return edge.kind === 'member';
    case 'relations':
      return edge.kind === 'relation' && lens.relations.includes(edge.relation);
    case 'flow':
      return edge.kind === 'flow' && lens.include.includes(edge.part);
    case 'graph':
      return edge.kind === 'relation' && lens.relations.includes(edge.relation);
  }
}

function canEnumerateAtDepth(lens: DataLens, depth: number): boolean {
  if (lens.kind === 'self' || lens.kind === 'selection') return false;
  return lens.kind === 'graph' || depth === 0;
}

function outputEdge(
  sourceRel: string,
  edge: ContractGraphEdgeReference,
): AuthorizedContractGraphEdge {
  return { ...edge, sourceRel };
}

function truncationReceipt(
  sourceRel: string,
  edge: ContractGraphEdgeReference,
  reason: ContractGraphTruncationReason,
): ContractGraphTruncationReceipt {
  if (edge.kind === 'relation') {
    return { sourceRel, reason, kind: edge.kind, relation: edge.relation };
  }
  if (edge.kind === 'flow') {
    return { sourceRel, reason, kind: edge.kind, part: edge.part };
  }
  return { sourceRel, reason, kind: edge.kind };
}

function edgeKey(sourceRel: string, edge: ContractGraphEdgeReference): string {
  const selector = edge.kind === 'relation' ? edge.relation : edge.kind === 'flow' ? edge.part : '';
  return `${sourceRel}\u0000${edge.kind}\u0000${selector}\u0000${edge.targetRel}`;
}

function truncationKey(receipt: ContractGraphTruncationReceipt): string {
  const selector =
    receipt.kind === 'relation' ? receipt.relation : receipt.kind === 'flow' ? receipt.part : '';
  return `${receipt.sourceRel}\u0000${receipt.reason}\u0000${receipt.kind}\u0000${selector}`;
}

async function authorized<TEntity>(
  dependencies: ContractGraphResolverDependencies<TEntity>,
  request: ContractGraphAuthorizationRequest,
): Promise<boolean> {
  try {
    return (await dependencies.authorize(request)) === true;
  } catch {
    return false;
  }
}

async function fetched<TEntity>(
  dependencies: ContractGraphResolverDependencies<TEntity>,
  rel: string,
): Promise<TEntity | undefined> {
  try {
    return await dependencies.fetch(rel);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a bounded Data Lens as an authorized graph. The resolver is deliberately unaware of
 * Siren, HTTP, Cedar or storage: adapters expose current entities and candidate contract edges,
 * while this kernel owns traversal semantics, authorization order and non-leaking receipts.
 */
export async function resolveAuthorizedContractGraph<TEntity>(
  input: RenderSituation,
  dependencies: ContractGraphResolverDependencies<TEntity>,
): Promise<AuthorizedContractGraph> {
  const situation = parseRenderSituation(input);
  const result: AuthorizedContractGraph = {
    roots: [],
    nodes: [],
    edges: [],
    truncations: [],
  };
  const nodesByRel = new Map<string, ContractGraphFetchedNode<TEntity>>();
  const queue: ContractGraphFetchedNode<TEntity>[] = [];
  const emittedEdges = new Set<string>();
  const emittedTruncations = new Set<string>();

  for (const root of situation.roots) {
    const allowed = await authorized(dependencies, {
      kind: 'root',
      targetRel: root.rel,
      audience: situation.audience,
    });
    if (!allowed) continue;
    const value = await fetched(dependencies, root.rel);
    if (value === undefined) continue;
    const node = { rel: root.rel, depth: 0, value };
    nodesByRel.set(root.rel, node);
    result.roots.push(root.rel);
    result.nodes.push({ rel: node.rel, depth: node.depth });
    queue.push(node);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const source = queue[cursor];
    if (!canEnumerateAtDepth(situation.lens, source.depth)) continue;

    let candidates: readonly ContractGraphEdgeReference[];
    try {
      candidates = [...dependencies.enumerateEdges(source)];
    } catch {
      continue;
    }

    for (const candidate of candidates) {
      const edge = normalizeEdgeReference(candidate);
      if (edge === undefined || !edgeSelected(situation.lens, edge)) continue;
      const allowed = await authorized(dependencies, {
        kind: 'edge',
        sourceRel: source.rel,
        targetRel: edge.targetRel,
        edge,
        audience: situation.audience,
      });
      if (!allowed) continue;

      const existing = nodesByRel.get(edge.targetRel);
      if (existing !== undefined) {
        const key = edgeKey(source.rel, edge);
        if (!emittedEdges.has(key)) {
          result.edges.push(outputEdge(source.rel, edge));
          emittedEdges.add(key);
        }
        continue;
      }

      let reason: ContractGraphTruncationReason | undefined;
      if (source.depth >= situation.budget.maxDepth) reason = 'max-depth';
      else if (result.nodes.length >= situation.budget.maxNodes) reason = 'max-nodes';
      if (reason !== undefined) {
        const receipt = truncationReceipt(source.rel, edge, reason);
        const key = truncationKey(receipt);
        if (!emittedTruncations.has(key)) {
          result.truncations.push(receipt);
          emittedTruncations.add(key);
        }
        continue;
      }

      const value = await fetched(dependencies, edge.targetRel);
      if (value === undefined) continue;
      const target = { rel: edge.targetRel, depth: source.depth + 1, value };
      nodesByRel.set(target.rel, target);
      result.nodes.push({ rel: target.rel, depth: target.depth });
      result.edges.push(outputEdge(source.rel, edge));
      emittedEdges.add(edgeKey(source.rel, edge));
      queue.push(target);
    }
  }

  return result;
}
