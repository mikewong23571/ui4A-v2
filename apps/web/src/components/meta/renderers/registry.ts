import type { SirenEntity } from '@ui4a/engine';

export type MetaRendererId =
  | 'application'
  | 'agent-definition'
  | 'draft'
  | 'flow'
  | 'activation'
  | 'capability'
  | 'generic-collection'
  | 'generic-detail';

export interface MetaRendererRegistration {
  id: MetaRendererId;
  /** Every token must be present in the Siren class list. */
  classes: readonly string[];
  matches?: (entity: SirenEntity) => boolean;
}

export interface KnownMetaEntityShape {
  name: string;
  classes: readonly string[];
  renderer: MetaRendererId;
}

export interface MetaRendererRegistry {
  resolve(entity: SirenEntity): MetaRendererId;
}

/**
 * Canonical top-level and embedded Meta shapes emitted by the current contract projectors.
 * Adding a known shape here without a corresponding registration fails registry completeness tests.
 */
export const KNOWN_META_ENTITY_SHAPES: readonly KnownMetaEntityShape[] = [
  { name: 'flow definition', classes: ['meta', 'flow-definition'], renderer: 'flow' },
  { name: 'activation', classes: ['meta', 'activation'], renderer: 'activation' },
  {
    name: 'capability definition',
    classes: ['meta', 'capability-definition'],
    renderer: 'capability',
  },
  {
    name: 'application definition',
    classes: ['meta', 'application-definition'],
    renderer: 'application',
  },
  { name: 'flow draft', classes: ['meta', 'draft', 'flow-definition'], renderer: 'draft' },
  {
    name: 'agent definition draft',
    classes: ['meta', 'draft', 'agent-definition'],
    renderer: 'draft',
  },
  {
    name: 'agent definition',
    classes: ['meta', 'agent-definition'],
    renderer: 'agent-definition',
  },
  {
    name: 'flows collection',
    classes: ['collection', 'meta/flows'],
    renderer: 'generic-collection',
  },
  {
    name: 'activations collection',
    classes: ['collection', 'meta/activations'],
    renderer: 'generic-collection',
  },
  {
    name: 'capabilities collection',
    classes: ['collection', 'meta/capabilities'],
    renderer: 'generic-collection',
  },
  {
    name: 'applications collection',
    classes: ['collection', 'meta/applications'],
    renderer: 'generic-collection',
  },
  {
    name: 'drafts collection',
    classes: ['collection', 'meta/drafts'],
    renderer: 'generic-collection',
  },
  {
    name: 'agent definitions collection',
    classes: ['collection', 'meta/agent-definitions'],
    renderer: 'generic-collection',
  },
  {
    name: 'node definition',
    classes: ['meta', 'node-definition'],
    renderer: 'generic-detail',
  },
  {
    name: 'action definition',
    classes: ['meta', 'action-definition'],
    renderer: 'generic-detail',
  },
  {
    name: 'definition version',
    classes: ['meta', 'definition-version'],
    renderer: 'generic-detail',
  },
  {
    name: 'application definition summary',
    classes: ['meta', 'application-definition-summary'],
    renderer: 'generic-detail',
  },
  {
    name: 'agent definition summary',
    classes: ['agent-definition-summary'],
    renderer: 'generic-detail',
  },
];

const isNotDraft = (entity: SirenEntity) => !entity.class.includes('draft');

/** Registration data is the only class-to-renderer mapping used by the canonical Meta page. */
export const META_RENDERER_REGISTRATIONS: readonly MetaRendererRegistration[] = [
  { id: 'application', classes: ['application-definition'] },
  { id: 'agent-definition', classes: ['agent-definition'], matches: isNotDraft },
  { id: 'draft', classes: ['draft'] },
  { id: 'flow', classes: ['flow-definition'], matches: isNotDraft },
  { id: 'activation', classes: ['activation'] },
  { id: 'capability', classes: ['capability-definition'] },
  { id: 'generic-collection', classes: ['collection', 'meta/flows'] },
  { id: 'generic-collection', classes: ['collection', 'meta/activations'] },
  { id: 'generic-collection', classes: ['collection', 'meta/capabilities'] },
  { id: 'generic-collection', classes: ['collection', 'meta/applications'] },
  { id: 'generic-collection', classes: ['collection', 'meta/drafts'] },
  { id: 'generic-collection', classes: ['collection', 'meta/agent-definitions'] },
  { id: 'generic-detail', classes: ['node-definition'] },
  { id: 'generic-detail', classes: ['action-definition'] },
  { id: 'generic-detail', classes: ['definition-version'] },
  { id: 'generic-detail', classes: ['application-definition-summary'] },
  { id: 'generic-detail', classes: ['agent-definition-summary'] },
];

/** Deterministic class registry. Any multiple match is an authoring error, never precedence. */
export function createMetaRendererRegistry(
  registrations: readonly MetaRendererRegistration[],
): MetaRendererRegistry {
  return {
    resolve(entity) {
      const classes = new Set(entity.class);
      const matches = registrations.filter(
        (entry) =>
          entry.classes.every((candidate) => classes.has(candidate)) &&
          (entry.matches?.(entity) ?? true),
      );
      if (matches.length > 1) {
        throw new Error(
          `ambiguous Meta renderer: ${matches
            .map((entry) => `${entry.id}[${entry.classes.join('+')}]`)
            .join(', ')}`,
        );
      }
      if (matches[0] !== undefined) return matches[0].id;
      return classes.has('collection') ? 'generic-collection' : 'generic-detail';
    },
  };
}
