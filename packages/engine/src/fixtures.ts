/**
 * 测试专用 flow 常量(spec.md 架构决定 5 的种子域形状)。
 * 仅被 *.test.ts 引用,不进引擎公共导出;Phase C 才落地真正的种子域。
 */
import type { FlowDefinition } from './types';

/** B1:三步发布向导。 */
export const articleDraftingFlow: FlowDefinition = {
  name: 'article-drafting',
  title: '文章发布向导',
  initial: 'basic-info',
  nodes: [
    {
      name: 'basic-info',
      title: '基本信息',
      fields: [{ name: 'title', type: 'text', required: true, semantics: 'intent' }],
      actions: [{ name: 'next', title: '下一步', to: 'classification' }],
    },
    {
      name: 'classification',
      title: '分类',
      fields: [
        {
          name: 'category',
          type: 'select',
          required: true,
          options: ['tech', 'essay', 'review'],
          semantics: 'org-standard',
          source: { kind: 'static' },
        },
        { name: 'tags', type: 'text', semantics: 'intent' },
      ],
      actions: [{ name: 'next', title: '下一步', to: 'content' }],
    },
    {
      name: 'content',
      title: '正文',
      fields: [
        {
          name: 'body',
          type: 'textarea',
          required: true,
          semantics: 'work-product',
          source: { kind: 'proposal', capability: 'draft', options: 3, selection: 'human-required' },
        },
      ],
      actions: [{ name: 'next', title: '完成', to: 'ready' }],
    },
    {
      name: 'ready',
      title: '就绪',
      actions: [
        {
          name: 'publish',
          title: '发布',
          to: 'done',
          effect: [
            { type: 'transition' },
            { type: 'append', collection: 'articles', 'resource-type': 'post', 'name-from': 'title', node: 'published' },
          ],
        },
      ],
    },
    {
      name: 'done',
      title: '完成',
      actions: [],
    },
  ],
};

/** B2:文章状态机(archive 的 requires-confirmation 仅作类型字段,T3 才挂确认)。 */
export const postStatusFlow: FlowDefinition = {
  name: 'post-status',
  title: '文章状态',
  initial: 'published',
  nodes: [
    {
      name: 'published',
      title: '已发布',
      actions: [
        { name: 'unpublish', title: '下线', to: 'offline' },
        { name: 'archive', title: '归档', to: 'archived', 'requires-confirmation': 'high' },
      ],
    },
    { name: 'offline', title: '已下线', actions: [] },
    { name: 'archived', title: '已归档', actions: [] },
  ],
};

/** B3:评论审核。 */
export const commentModerationFlow: FlowDefinition = {
  name: 'comment-moderation',
  title: '评论审核',
  initial: 'pending',
  nodes: [
    {
      name: 'pending',
      title: '待处理',
      actions: [
        { name: 'approve', title: '通过', to: 'approved', guards: ['is-pending'] },
        { name: 'reject', title: '驳回', to: 'rejected', guards: ['is-pending'] },
        { name: 'flag', title: '标记重审', to: 'pending', guards: ['is-pending'] },
      ],
    },
    { name: 'approved', title: '已通过', actions: [] },
    { name: 'rejected', title: '已驳回', actions: [] },
  ],
};

/** 最小合法 flow(测规范化默认值用)。 */
export const minimalFlow: FlowDefinition = {
  name: 'tiny',
  initial: 'a',
  nodes: [
    { name: 'a', actions: [{ name: 'go', title: 'Go', to: 'b' }] },
    { name: 'b', actions: [] },
  ],
};
