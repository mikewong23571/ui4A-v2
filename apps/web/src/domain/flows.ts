/**
 * 种子业务域:T2 阶段的 flow 常量(spec 架构决定 5,machine-as-JSON)。
 *
 * 三个 flow 支撑 B1–B3 验收场景:
 * - article-drafting(B1):三步发布向导 → publish 追加文章进 articles 集合;
 * - post-status(B2):published/offline/archived,unpublish 精确下线单篇;
 * - comment-moderation(B3):pending → approved | rejected。
 *
 * T4 起 flow 定义挪进事件日志(meta 平面);在此之前这里就是真相源。
 * 常量在模块加载时经 parseFlowDefinition 校验+规范化——非法定义在此处
 * 就响亮失败,而不是等到第一次 exec。
 */
import { parseFlowDefinition } from '@ui4a/engine';
import type { FlowDefinition } from '@ui4a/engine';

/** B1:文章发布三步向导(每步一个推进动作,fields 即该节点字段)。 */
const articleDrafting: FlowDefinition = {
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
      actions: [{ name: 'next', title: '完成编辑', to: 'ready' }],
    },
    {
      name: 'ready',
      title: '就绪',
      actions: [
        {
          name: 'publish',
          title: '发布',
          to: 'done',
          guards: ['title-not-taken'],
          // 发布参数只需 title(slug 来源);向导前序步骤的字段已落在实例上。
          fields: [{ name: 'title', type: 'text', required: true, semantics: 'intent' }],
          effect: [
            { type: 'transition' },
            {
              type: 'append',
              collection: 'articles',
              'resource-type': 'post',
              flow: 'post-status',
              'name-from': 'title',
              node: 'published',
            },
          ],
        },
      ],
    },
    { name: 'done', title: '完成', actions: [] },
  ],
};

/** B2:文章状态机(archive 的 requires-confirmation 仅存在,T3 才挂确认)。 */
const postStatus: FlowDefinition = {
  name: 'post-status',
  title: '文章状态',
  initial: 'published',
  nodes: [
    {
      name: 'published',
      title: '已发布',
      actions: [
        { name: 'unpublish', title: '下线', to: 'offline', guards: ['is-published'] },
        {
          name: 'archive',
          title: '归档',
          to: 'archived',
          guards: ['is-published'],
          'requires-confirmation': 'high',
        },
      ],
    },
    {
      name: 'offline',
      title: '已下线',
      actions: [{ name: 'republish', title: '重新发布', to: 'published' }],
    },
    { name: 'archived', title: '已归档', actions: [] },
  ],
};

/** B3:评论审核。 */
const commentModeration: FlowDefinition = {
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
      ],
    },
    { name: 'approved', title: '已通过', actions: [] },
    { name: 'rejected', title: '已驳回', actions: [] },
  ],
};

/** 校验+规范化后的 flow 常量(导出面;解析失败 = 定义 bug,模块加载即抛)。 */
export const articleDraftingFlow = parseFlowDefinition(articleDrafting);
export const postStatusFlow = parseFlowDefinition(postStatus);
export const commentModerationFlow = parseFlowDefinition(commentModeration);

/** 种子 flow 列表(声明序即 sitemap 展示序)。 */
export const businessFlowList: readonly FlowDefinition[] = [
  articleDraftingFlow,
  postStatusFlow,
  commentModerationFlow,
];

/** flow 注册表(name → 定义;judge/effects/project 的公共依赖形状)。 */
export const businessFlows: Readonly<Record<string, FlowDefinition>> = Object.fromEntries(
  businessFlowList.map((flow) => [flow.name, flow]),
);
