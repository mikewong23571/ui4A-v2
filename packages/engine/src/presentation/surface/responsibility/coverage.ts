import { parseCognitiveSemanticsProjection } from '../../../contract/cognitive-semantics';
import { isRecord } from '../internal';
import type { SurfaceCatalog, SurfaceNode, SurfaceTree, SurfaceWordNode } from '../types';

export interface ResponsibilitySource {
  subject: string;
  entity: unknown;
}

function canonicalRel(entity: Record<string, unknown>): string | undefined {
  const rel = isRecord(entity.properties) ? entity.properties.rel : undefined;
  return typeof rel === 'string' && rel !== '' ? rel : undefined;
}

function cognitionOf(entity: Record<string, unknown>) {
  const presentation = isRecord(entity.properties) ? entity.properties.presentation : undefined;
  if (!isRecord(presentation)) return undefined;
  try {
    const projection = Object.fromEntries(
      ['version', 'traits', 'groupRole', 'priority', 'emptyMeaning'].flatMap((key) =>
        key in presentation ? [[key, presentation[key]]] : [],
      ),
    );
    return parseCognitiveSemanticsProjection(projection);
  } catch {
    return undefined;
  }
}

function itemBinding(node: SurfaceWordNode, name: string, path: string): boolean {
  const binding = node.bindings[name];
  return binding?.kind === 'item' && binding.path === path;
}

/**
 * Coverage uses only authorized live projections, never saved dependency inventories. It proves
 * reference/action reachability, not visual quality. Container cognition does not turn lifecycle
 * actions into a pending responsibility; only explicit groupRole plus members marks a group.
 */
export function validateResponsibilityCoverage(
  surface: SurfaceTree,
  sources: readonly ResponsibilitySource[],
  catalog: SurfaceCatalog,
): { valid: boolean; missing: string[] } {
  const entities = new Map<string, Record<string, unknown>>();
  const required = new Map<string, boolean>();
  const identified = new Set<string>();
  const actionable = new Set<string>();
  const visited = new Set<unknown>();
  const collect = (value: unknown, alias?: string) => {
    if (!isRecord(value)) return;
    const rel = canonicalRel(value) ?? alias;
    if (rel !== undefined) entities.set(rel, value);
    if (alias !== undefined) entities.set(alias, value);
    if (visited.has(value)) return;
    visited.add(value);
    const cognition = cognitionOf(value);
    const group = cognition?.groupRole !== undefined && Array.isArray(value.entities);
    if (rel !== undefined && !group && cognition?.traits?.includes('human-responsibility')) {
      required.set(rel, Array.isArray(value.actions) && value.actions.length > 0);
    }
    if (Array.isArray(value.entities)) value.entities.forEach((member) => collect(member));
  };
  sources.forEach(({ subject, entity }) => collect(entity, subject));
  const relOf = (subject: string) => {
    const entity = entities.get(subject);
    return entity === undefined ? subject : (canonicalRel(entity) ?? subject);
  };
  const coverNested = (value: Record<string, unknown>) => {
    for (const child of Array.isArray(value.entities) ? value.entities : []) {
      if (!isRecord(child)) continue;
      const rel = canonicalRel(child);
      if (rel !== undefined && required.has(rel)) {
        identified.add(rel);
        actionable.add(rel);
      }
      coverNested(child);
    }
  };
  const visit = (node: SurfaceNode, item?: Record<string, unknown>) => {
    if (node.kind === 'layout') node.children.forEach((child) => visit(child, item));
    else if (node.kind === 'slot') visit(node.child, item);
    else if (node.kind === 'repeat') {
      const source = entities.get(node.source.subject);
      for (const member of Array.isArray(source?.entities) ? source.entities : []) {
        if (!isRecord(member)) continue;
        const rel = canonicalRel(member);
        if (rel !== undefined && node.exclude?.includes(rel)) continue;
        visit(node.item, member);
      }
    } else if (node.kind === 'word') {
      const definition = catalog.words[node.word];
      if (definition === undefined) return;
      const pattern = definition.pattern;
      if (item !== undefined && itemBinding(node, 'rel', 'properties.rel')) {
        const rel = canonicalRel(item);
        const row =
          pattern === 'member-row' && itemBinding(node, 'cognitive', 'properties.presentation');
        const decision = pattern === 'member-card' || pattern === 'member-table' || row;
        if (rel !== undefined && decision) {
          identified.add(rel);
          if (itemBinding(node, 'actions', 'actions')) actionable.add(rel);
        }
        // The generic row exposes nested declared responsibility links from the actual members;
        // that binding includes their canonical targets, actions and cognition without copying.
        if (row && itemBinding(node, 'members', 'entities')) coverNested(item);
      }
      for (const [name, binding] of Object.entries(node.bindings)) {
        if (!definition.bindings[name]?.sources.includes(binding.kind)) continue;
        if (binding.kind === 'property' && node.role === 'identity') {
          identified.add(relOf(binding.subject));
        }
        if (binding.kind === 'actions' && node.role === 'actions') {
          actionable.add(relOf(binding.subject));
        }
      }
    }
  };
  visit(surface.root);
  const missing = [...required]
    .flatMap(([rel, actions]) =>
      identified.has(rel) && (!actions || actionable.has(rel)) ? [] : [rel],
    )
    .sort();
  return { valid: missing.length === 0, missing };
}
