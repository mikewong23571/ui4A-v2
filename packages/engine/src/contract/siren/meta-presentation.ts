import type { CognitiveSemanticsDeclarationV1 } from '@ui4a/shared';

import {
  projectCognitiveSemantics,
  type CognitiveSemanticsProjectionV1,
} from '../cognitive-semantics';
import type { SirenFieldPresentation } from './types';

const META_TOP_LEVEL_COGNITION = {
  'meta/self': {
    version: 1,
    traits: ['audit-only'],
    groupRole: 'system',
    priority: 'low',
  },
  'meta/flows': {
    version: 1,
    traits: ['audit-only'],
    groupRole: 'definition',
    priority: 'normal',
    emptyMeaning: 'no-results',
  },
  'meta/activations': {
    version: 1,
    traits: ['human-responsibility', 'review-queue'],
    groupRole: 'responsibility',
    priority: 'high',
    emptyMeaning: 'no-current-responsibility',
  },
  'meta/applications': {
    version: 1,
    groupRole: 'definition',
    priority: 'normal',
    emptyMeaning: 'no-results',
  },
  'meta/capabilities': {
    version: 1,
    groupRole: 'definition',
    priority: 'normal',
    emptyMeaning: 'no-results',
  },
  'meta/drafts': {
    version: 1,
    traits: ['review-queue'],
    groupRole: 'candidate',
    priority: 'high',
    emptyMeaning: 'no-results',
  },
  'meta/agent-definitions': {
    version: 1,
    groupRole: 'definition',
    priority: 'normal',
    emptyMeaning: 'no-results',
  },
} as const satisfies Record<string, CognitiveSemanticsDeclarationV1>;

export type MetaMemberSummaryKind =
  'application' | 'flow' | 'activation' | 'capability' | 'draft' | 'agent-definition';

const META_MEMBER_OVERVIEW_FIELDS = {
  application: [
    { path: 'properties.title', title: '名称', role: 'identity', overview: true },
    { path: 'properties.intent', title: '用途', role: 'primary-content', overview: true },
    { path: 'properties.version', title: '版本', role: 'metadata', overview: true },
    { path: 'properties.flowCount', title: '流程', role: 'metadata', overview: true },
    { path: 'properties.capabilityCount', title: '能力', role: 'metadata', overview: true },
    { path: 'properties.policyCount', title: '策略', role: 'metadata', overview: true },
  ],
  flow: [
    { path: 'properties.title', title: '名称', role: 'identity', overview: true },
    { path: 'properties.status', title: '状态', role: 'status', overview: true },
    { path: 'properties.version', title: '版本', role: 'metadata', overview: true },
  ],
  activation: [
    { path: 'properties.flow', title: '目标 Flow', role: 'identity', overview: true },
    { path: 'properties.status', title: '状态', role: 'status', overview: true },
    { path: 'properties.version', title: '候选版本', role: 'metadata', overview: true },
  ],
  capability: [
    { path: 'properties.title', title: '名称', role: 'identity', overview: true },
    { path: 'properties.intent', title: '用途', role: 'primary-content', overview: true },
    { path: 'properties.kind', title: '类型', role: 'metadata', overview: true },
  ],
  draft: [
    { path: 'properties.target', title: '目标', role: 'identity', overview: true },
    { path: 'properties.kind', title: '类型', role: 'metadata', overview: true },
    { path: 'properties.status', title: '状态', role: 'status', overview: true },
    { path: 'properties.version', title: '版本', role: 'metadata', overview: true },
  ],
  'agent-definition': [
    { path: 'properties.name', title: '名称', role: 'identity', overview: true },
    { path: 'properties.intent', title: '用途', role: 'primary-content', overview: true },
    { path: 'properties.version', title: '版本', role: 'metadata', overview: true },
    { path: 'properties.runtimeClass', title: '运行时', role: 'metadata', overview: true },
  ],
} as const satisfies Record<MetaMemberSummaryKind, readonly SirenFieldPresentation[]>;

/** One declared source consumed by both Meta sitemap and exact collection projections. */
export function metaTopLevelPresentation(rel: string): CognitiveSemanticsProjectionV1 | undefined {
  const declaration = META_TOP_LEVEL_COGNITION[rel as keyof typeof META_TOP_LEVEL_COGNITION];
  return projectCognitiveSemantics({ declaration });
}

/** Attach cognition to an existing contract surface without manufacturing unknown semantics. */
export function withMetaTopLevelPresentation<T extends { rel: string }>(
  surface: T,
): T & { presentation?: CognitiveSemanticsProjectionV1 } {
  const presentation = metaTopLevelPresentation(surface.rel);
  return { ...surface, ...(presentation === undefined ? {} : { presentation }) };
}

/** Overview references remain adjacent to each embedded summary schema and never copy facts. */
export function metaMemberPresentation(
  kind: MetaMemberSummaryKind,
): CognitiveSemanticsProjectionV1 {
  return projectCognitiveSemantics({
    fieldPresentations: META_MEMBER_OVERVIEW_FIELDS[kind],
  })!;
}
