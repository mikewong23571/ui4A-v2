import type { SurfaceCatalog } from '@ui4a/engine';

/** Semantic catalog planned by AI and compiled to the concrete A2UI catalog at runtime. */
export const PRESENTATION_SURFACE_CATALOG: SurfaceCatalog = {
  id: 'urn:ui4a:presentation:semantic',
  version: 'semantic-v5', // T35 F-06:规划器簿记数字跳过/成员状态标题化,版本 +1 使缓存面失效
  words: {
    heading: {
      roles: ['identity'],
      bindings: { value: { sources: ['property', 'item'], required: true } },
    },
    prose: {
      roles: ['primary-content', 'metadata', 'relation'],
      bindings: { value: { sources: ['property', 'item'], required: true } },
    },
    state: {
      roles: ['status'],
      bindings: { value: { sources: ['property'], required: true } },
    },
    controls: {
      roles: ['actions'],
      bindings: { actions: { sources: ['actions'], required: true } },
    },
    references: {
      roles: ['relation'],
      bindings: { links: { sources: ['links'], required: true } },
    },
    collection: {
      roles: ['relation'],
      bindings: { entities: { sources: ['entities'], required: true } },
    },
    'member-link': {
      roles: ['identity'],
      pattern: 'member-link',
      bindings: {
        label: { sources: ['item'], required: true },
        rel: { sources: ['item'], required: true },
        status: { sources: ['item'] },
        detail: { sources: ['item'] },
      },
    },
    'member-card': {
      roles: ['identity'],
      pattern: 'member-card',
      bindings: {
        label: { sources: ['item'], required: true },
        rel: { sources: ['item'], required: true },
        status: { sources: ['item'] },
        detail: { sources: ['item'] },
        actions: { sources: ['item'] },
        guardResults: { sources: ['item'] },
        fields: { sources: ['item'] },
      },
    },
  },
};
