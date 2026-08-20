/**
 * 种子 guard 谓词(spec 架构决定 2:实现放 shared,engine 只持注册表)。
 *
 * 铁律(arch-brief §3):纯且快、只读快照、永远不调 capability——
 * capability 结果先落状态,guard 再读状态。
 */
import type { GuardContext, GuardPredicate, GuardRegistry } from './guards';

/** 实例当前节点等于给定节点。 */
export function nodeIs(node: string): GuardPredicate {
  return (context: GuardContext) => context.instance.node === node;
}

/** 实例处于待处理节点(评论审核队列的入门谓词)。 */
export const isPending: GuardPredicate = nodeIs('pending');

/** 实例处于已发布节点(post-status 的可下线/可归档谓词)。 */
export const isPublished: GuardPredicate = nodeIs('published');

/**
 * 拟发布文章标题未被既有文章占用(发布向导 publish 的 guard)。
 * 跨实例只读快照演示 guard 的真实用途:状态相关而非节点同义反复——
 * 重名发布被拒并留痕,拒绝即教育(B1 的字段级自救场景)。
 */
export const titleNotTaken: GuardPredicate = (context) => {
  const candidate = context.params.title;
  if (typeof candidate !== 'string') return true;
  for (const instance of Object.values(context.snapshot.instances)) {
    if (instance.flow !== 'post-status') continue;
    if (instance.fields.title?.value === candidate) return false;
  }
  return true;
};

/** 恒真(空 guard 动作的显式占位,亦用于测试)。 */
export const alwaysTrue: GuardPredicate = () => true;

/**
 * 本次 exec 的行为者是人类(铁律 5"审批不委托":确认实体的 approve/reject guard)。
 * 无 actor 上下文(Siren 投影求值)时 fail-closed 为 false——
 * 投影不是裁决,真正判定永远发生在 exec 时(同一个谓词的两个投影)。
 */
export const actorIsHuman: GuardPredicate = (context) => context.actor === 'human';

/** 种子注册表:名字 → 谓词。meta/registries 的运行时子集。 */
export const seedGuardRegistry: GuardRegistry = {
  'is-pending': isPending,
  'is-published': isPublished,
  'title-not-taken': titleNotTaken,
  'always-true': alwaysTrue,
  'actor-is-human': actorIsHuman,
};
