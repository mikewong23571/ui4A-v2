import type { SurfaceCatalog } from '@ui4a/engine';

/** Semantic catalog planned by AI and compiled to the concrete A2UI catalog at runtime. */
export const PRESENTATION_SURFACE_CATALOG: SurfaceCatalog = {
  id: 'urn:ui4a:presentation:semantic',
  // T38:集合查询词汇(collection-filters/page-links)与 member-table 概览绑定
  // 入目录;版本 +1 使既有缓存面失效(词位与绑定形状变更)。
  version: 'semantic-v6',
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
    'member-table': {
      roles: ['identity'],
      pattern: 'member-table',
      bindings: {
        label: { sources: ['item'], required: true },
        rel: { sources: ['item'], required: true },
        status: { sources: ['item'] },
        detail: { sources: ['item'] },
        actions: { sources: ['item'] },
        guardResults: { sources: ['item'] },
        fields: { sources: ['item'] },
        // T38 FR4:成员呈现元数据(声明序 + title + overview hint)→ 概览列。
        presentations: { sources: ['item'] },
      },
    },
    // T38 FR3/FR5:集合读面查询词汇(声明驱动,零实体特判;规划器按 pattern
    // 供给绑定——过滤词吃声明维度 + 合同 self 链接,分页词吃声明的 next/prev)。
    'collection-filters': {
      roles: ['relation'],
      pattern: 'collection-filters',
      bindings: {
        declarations: { sources: ['property'], required: true },
        links: { sources: ['links'] },
      },
    },
    'page-links': {
      roles: ['relation'],
      pattern: 'page-links',
      bindings: { links: { sources: ['links'], required: true } },
    },
  },
};
