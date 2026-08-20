/**
 * 种子数据:以 seed 事件入日志(重放一致性自动获得,fold 的 applySeed 幂等)。
 *
 * 载荷支撑 B1–B3 起步状态:
 * - 2 篇已发布文章(post:post-welcome「欢迎来到 UI4A」、post:first-post「第一篇」);
 * - 4 条评论:c1/c2/c3 pending(B3 队列)、c4 approved(终态样例);
 * - 1 个发布向导实例(B1 入口,从 basic-info 起步)。
 *
 * 字段出处记 'default':种子值来自应用引导,不是任何 actor 的意图/起草/引出
 * ("事实永不发明"——每个值都说得清来路)。
 */
import type { SeedDetail } from '@ui4a/engine';
import type { FieldValue, InstanceSnapshot } from '@ui4a/shared';

/** seed 事件的稳定标识(启动幂等 seed 的查重键)。 */
export const SEED_REL = 'seed:business-domain';

function instance(
  rel: string,
  flow: string,
  node: string,
  fields: Record<string, string> = {},
): InstanceSnapshot {
  const seeded: Record<string, FieldValue> = Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [name, { value, origin: 'default' }]),
  );
  return { rel, flow, node, fields: seeded };
}

/** 种子载荷(seed 事件的 detail;形状 = engine fold 的 SeedDetail)。 */
export const seedDetail: SeedDetail = {
  instances: {
    'post:post-welcome': instance('post:post-welcome', 'post-status', 'published', {
      title: '欢迎来到 UI4A',
      category: 'tech',
    }),
    'post:first-post': instance('post:first-post', 'post-status', 'published', {
      title: '第一篇',
      category: 'essay',
    }),
    'comment:c1': instance('comment:c1', 'comment-moderation', 'pending', { body: '好文章' }),
    'comment:c2': instance('comment:c2', 'comment-moderation', 'pending', { body: '学习了' }),
    'comment:c3': instance('comment:c3', 'comment-moderation', 'pending', { body: '期待下一篇' }),
    'comment:c4': instance('comment:c4', 'comment-moderation', 'approved', { body: '赞' }),
    'article-drafting:main': instance('article-drafting:main', 'article-drafting', 'basic-info'),
  },
  collections: {
    articles: ['post:post-welcome', 'post:first-post'],
    comments: ['comment:c1', 'comment:c2', 'comment:c3', 'comment:c4'],
  },
};
