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

/** 恒真(空 guard 动作的显式占位,亦用于测试)。 */
export const alwaysTrue: GuardPredicate = () => true;

/** 种子注册表:名字 → 谓词。meta/registries 的运行时子集。 */
export const seedGuardRegistry: GuardRegistry = {
  'is-pending': isPending,
  'is-published': isPublished,
  'always-true': alwaysTrue,
};
