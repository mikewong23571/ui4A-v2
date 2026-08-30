/**
 * Collection ownership is derived from active Flow declarations only. Explicit
 * `collections` declarations are authoritative; append effects are a fallback
 * for collections that do not yet have an explicit declaration.
 */
import { actionEffects } from '../core/parse';
import type { FlowDefinition } from '../core/types';
import {
  projectCognitiveSemantics,
  type CognitiveSemanticsProjectionV1,
} from './cognitive-semantics';
import { fieldPresentationsOf } from './siren/build';

export interface CollectionOwner {
  rel: string;
  title?: string;
  app: string;
  flow: FlowDefinition;
  source: 'declaration' | 'append';
}

type OwnerCandidate = CollectionOwner;

function ownerLabel(owner: OwnerCandidate): string {
  return `${owner.flow.name} (Application ${owner.app}, ${owner.source})`;
}

function conflict(rel: string, reason: string, owners: readonly OwnerCandidate[]): never {
  throw new Error(
    `Collection ownership conflict for "${rel}": ${reason}: ${owners.map(ownerLabel).join(', ')}`,
  );
}

function uniqueCandidates(candidates: readonly OwnerCandidate[]): OwnerCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.source}\u0000${candidate.app}\u0000${candidate.flow.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pure declaration-first resolver shared by sitemap and exact Siren projection. */
export function resolveCollectionOwnership(
  flows: readonly FlowDefinition[],
): ReadonlyMap<string, CollectionOwner> {
  const explicit = new Map<string, OwnerCandidate[]>();
  const appended = new Map<string, OwnerCandidate[]>();

  for (const flow of flows) {
    const app = flow.app ?? 'default';
    for (const declaration of flow.collections ?? []) {
      const candidates = explicit.get(declaration.collection) ?? [];
      candidates.push({
        rel: declaration.collection,
        ...(declaration.title === undefined ? {} : { title: declaration.title }),
        app,
        flow,
        source: 'declaration',
      });
      explicit.set(declaration.collection, candidates);
    }
    for (const node of flow.nodes) {
      for (const action of node.actions) {
        for (const effect of actionEffects(action)) {
          if (effect.type !== 'append') continue;
          const candidates = appended.get(effect.collection) ?? [];
          candidates.push({ rel: effect.collection, app, flow, source: 'append' });
          appended.set(effect.collection, candidates);
        }
      }
    }
  }

  const ownership = new Map<string, CollectionOwner>();
  const rels = new Set([...explicit.keys(), ...appended.keys()]);
  for (const rel of rels) {
    const declarations = uniqueCandidates(explicit.get(rel) ?? []);
    const appenders = uniqueCandidates(appended.get(rel) ?? []);
    if (declarations.length > 1) {
      conflict(rel, 'multiple explicit Flow.collections owners', declarations);
    }
    const declaration = declarations[0];
    if (declaration !== undefined) {
      const conflicts = appenders.filter((candidate) => candidate.app !== declaration.app);
      if (conflicts.length > 0) {
        conflict(rel, 'append owner differs from the explicit owner', [declaration, ...conflicts]);
      }
      ownership.set(rel, declaration);
      continue;
    }
    if (appenders.length > 1) {
      conflict(rel, 'multiple append owners without an explicit declaration', appenders);
    }
    if (appenders[0] !== undefined) ownership.set(rel, appenders[0]);
  }
  return ownership;
}

/** Owner-only cognitive and field presentation; runtime members never contribute columns. */
export function collectionOwnerPresentation(
  owner: CollectionOwner,
): CognitiveSemanticsProjectionV1 | undefined {
  return projectCognitiveSemantics({
    declaration: owner.flow.cognitive,
    fieldPresentations: fieldPresentationsOf(owner.flow.fields ?? [], {}),
  });
}
