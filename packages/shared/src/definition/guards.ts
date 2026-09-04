/**
 * guard 合同:谓词注册表的名字→纯函数形状(engine 只持注册表,实现在本包)。
 *
 * 铁律(arch-brief §3):guard 纯且快、只读快照、永远不调 capability——
 * capability 结果先落状态,guard 再读状态。
 * "按钮的 disabled 与 Agent 看到的 guard 不满足是同一个谓词的两个投影。"
 */
import type { ActionDefinition } from './definition';
import type { EngineSnapshot, InstanceSnapshot } from './state';

/**
 * guard 求值上下文:实例 + 全局快照(只读)+ 本次动作参数。
 * actor 为 T3 扩展(可选,最小侵入:既有谓词不读它,全部仍编译)——
 * actor-is-human 读它判定"审批不委托"(铁律 5);
 * 投影路径无 actor 上下文(求值时缺省),谓词按 fail-closed 处理。
 */
export interface GuardContext {
  instance: Readonly<InstanceSnapshot>;
  snapshot: Readonly<EngineSnapshot>;
  params: Readonly<Record<string, unknown>>;
  /** 当前被裁决的动作声明；通用 provenance guard 用字段 source 读取约束。 */
  action?: Readonly<ActionDefinition>;
  /** 本次 exec 的行为者(exec 裁决时必填;Siren 投影时缺省)。 */
  actor?: 'human' | 'agent';
  /** Internal system callbacks carry a non-forgeable system principal. */
  principal?: string;
  /**
   * 已注册的 guard 名集合(T4:guards-registered 谓词读它——编辑动词声明的
   * guard 名必须在注册表内)。由裁决器从 GuardRegistry 派生注入;
   * 投影路径同样携带(evaluateGuards 统一构造)。
   */
  knownGuards?: ReadonlySet<string>;
}

/** 谓词:纯函数,输入快照与参数,输出布尔。 */
export type GuardPredicate = (context: GuardContext) => boolean;

/** 注册表:名字 → 谓词。 */
export type GuardRegistry = Readonly<Record<string, GuardPredicate>>;

/** 单个 guard 的求值结果(逐项注入实体 guard-results;拒绝即教育)。 */
export interface GuardEvaluation {
  name: string;
  pass: boolean;
  /** 失败/异常原因(如 guard 未注册、谓词抛错)。 */
  reason?: string;
}

/**
 * 平台守卫的人话注记(D-5/F-10,合同数据层):名字 → 一行失败原因描述。
 * Siren guard-results 的 reason 以此为人话主句,机器表达式退为审计括号;
 * 未登记的守卫(应用域自定义)回退原机器串——零渲染器文案模板。
 */
export const GUARD_HINTS: Readonly<Record<string, string>> = {
  'is-pending': '该内容不处于待发布状态',
  'is-published': '该内容尚未发布',
  'title-not-taken': '该标题已被占用',
  'actor-is-human': '此操作需要人本人执行(审批不委托)',
  'principal-is-capability-system': '此操作仅限系统能力回调执行',
  'artifact-input-valid': '所选产物与该动作不匹配或已失效',
  'is-draft': '该定义不处于草稿状态',
  'is-active': '该定义未处于激活状态',
  'node-exists': '目标节点不存在',
  'node-not-exists': '目标节点不应存在',
  'to-exists': '声明的目标位置不存在',
  'guards-registered': '动作声明了未注册的守卫(定义缺陷)',
  'effect-known': '动作声明了未知效果(定义缺陷)',
  'action-not-exists': '动作不存在',
  'no-live-instances': '仍有进行中的实例,不能删除该定义',
  'application-not-default': '默认应用不可停用(系统地板)',
};
