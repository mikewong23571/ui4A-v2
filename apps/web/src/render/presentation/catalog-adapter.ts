import { MessageProcessor, type Catalog, type ComponentApi } from '@a2ui/web_core/v0_9';

import { ui4aRenderCatalog } from '../canvas/word-catalog';

export type A2uiHydrationTransform = 'value' | 'actions-entity' | 'links-entity';

export interface A2uiWordBindingAdapter {
  prop: string;
  transform: A2uiHydrationTransform;
}

export interface A2uiWordAdapter {
  component: string;
  bindings: Readonly<Record<string, A2uiWordBindingAdapter>>;
  props?: Readonly<Record<string, unknown>>;
}

export interface A2uiCatalogAdapter {
  catalogId: string;
  fingerprint: string;
  runtimeCatalog: Catalog<ComponentApi>;
  layouts: Readonly<Record<'stack' | 'grid' | 'inline', string>>;
  slotComponent: string;
  repeatComponent: string;
  diagnosticComponent: string;
  words: Readonly<Record<string, A2uiWordAdapter>>;
}

const layouts = {
  stack: 'Column',
  grid: 'Row',
  inline: 'Row',
} as const;

const words: Readonly<Record<string, A2uiWordAdapter>> = {
  heading: {
    component: 'semantic-text',
    bindings: { value: { prop: 'value', transform: 'value' } },
    props: { variant: 'heading' },
  },
  prose: {
    component: 'semantic-text',
    bindings: { value: { prop: 'value', transform: 'value' } },
    props: { variant: 'prose' },
  },
  state: {
    component: 'semantic-text',
    bindings: { value: { prop: 'value', transform: 'value' } },
    props: { variant: 'status' },
  },
  controls: {
    component: 'detail',
    bindings: { actions: { prop: 'entity', transform: 'actions-entity' } },
    props: { mode: 'actions' },
  },
  references: {
    component: 'detail',
    bindings: { links: { prop: 'entity', transform: 'links-entity' } },
    props: { mode: 'links' },
  },
  collection: {
    component: 'table',
    bindings: { entities: { prop: 'rows', transform: 'value' } },
  },
  'member-link': {
    component: 'entity-link',
    bindings: {
      label: { prop: 'label', transform: 'value' },
      rel: { prop: 'rel', transform: 'value' },
      status: { prop: 'status', transform: 'value' },
      detail: { prop: 'detail', transform: 'value' },
    },
  },
  'member-card': {
    component: 'member-card',
    bindings: {
      label: { prop: 'label', transform: 'value' },
      rel: { prop: 'rel', transform: 'value' },
      status: { prop: 'status', transform: 'value' },
      detail: { prop: 'detail', transform: 'value' },
      actions: { prop: 'actions', transform: 'value' },
      guardResults: { prop: 'guardResults', transform: 'value' },
      fields: { prop: 'fields', transform: 'value' },
      presentations: { prop: 'presentations', transform: 'value' },
    },
  },
  'member-table': {
    component: 'member-table',
    bindings: {
      label: { prop: 'label', transform: 'value' },
      rel: { prop: 'rel', transform: 'value' },
      status: { prop: 'status', transform: 'value' },
      detail: { prop: 'detail', transform: 'value' },
      actions: { prop: 'actions', transform: 'value' },
      guardResults: { prop: 'guardResults', transform: 'value' },
      fields: { prop: 'fields', transform: 'value' },
      presentations: { prop: 'presentations', transform: 'value' },
    },
  },
  // T38 FR3/FR5:集合读面查询词汇(声明驱动)。
  'collection-filters': {
    component: 'collection-filters',
    bindings: {
      declarations: { prop: 'declarations', transform: 'value' },
      links: { prop: 'links', transform: 'value' },
    },
  },
  'page-links': {
    component: 'page-links',
    bindings: { links: { prop: 'links', transform: 'value' } },
  },
  'empty-state': {
    component: 'empty-state',
    bindings: { meaning: { prop: 'meaning', transform: 'value' } },
  },
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function inlineComponents(catalog: Catalog<ComponentApi>): Record<string, unknown> {
  const capabilities = new MessageProcessor([catalog]).getClientCapabilities({
    includeInlineCatalogs: true,
    version: 'v0.9',
  }) as unknown as {
    'v0.9': {
      inlineCatalogs?: Array<{ catalogId: string; components: Record<string, unknown> }>;
    };
  };
  const inline = capabilities['v0.9'].inlineCatalogs?.find(
    (candidate) => candidate.catalogId === catalog.id,
  );
  if (inline === undefined) {
    throw new Error(`A2UI catalog "${catalog.id}" did not expose an inline schema`);
  }
  return inline.components;
}

export function createA2uiCatalogAdapter(
  runtimeCatalog: Catalog<ComponentApi>,
): A2uiCatalogAdapter {
  const requiredComponents = new Set([
    ...Object.values(layouts),
    'Column',
    'List',
    'Text',
    ...Object.values(words).map((word) => word.component),
  ]);
  const missing = [...requiredComponents].filter(
    (component) => !runtimeCatalog.components.has(component),
  );
  if (missing.length > 0) {
    throw new Error(`A2UI catalog adapter references missing components: ${missing.join(', ')}`);
  }

  const schemas = inlineComponents(runtimeCatalog);
  const usedSchemas = Object.fromEntries(
    [...requiredComponents].sort().map((component) => [component, schemas[component]]),
  );
  const contract = {
    catalogId: runtimeCatalog.id,
    layouts,
    slotComponent: 'Column',
    repeatComponent: 'List',
    diagnosticComponent: 'Text',
    words,
    components: usedSchemas,
  };

  return {
    catalogId: runtimeCatalog.id,
    fingerprint: fnv1a64(canonicalJson(contract)),
    runtimeCatalog,
    layouts,
    slotComponent: 'Column',
    repeatComponent: 'List',
    diagnosticComponent: 'Text',
    words,
  };
}

export const UI4A_A2UI_CATALOG_ADAPTER = createA2uiCatalogAdapter(
  ui4aRenderCatalog as unknown as Catalog<ComponentApi>,
);
