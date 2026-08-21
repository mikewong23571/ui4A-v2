/**
 * definition-lifecycle(A.4 原样,timeout/expired 除外):定义自身的状态机,
 * 以 machine-as-JSON 常量自举——编辑动词(add-node/add-action/submit)声明在
 * draft 节点、approve/reject 声明在 pending-approval 节点,全部过**同一个**
 * judge(声明→guard→schema)与同一套效果词汇表(meta-edit)。
 *
 * reserving:`definition-lifecycle` 是保留 flow 名(withLifecycleFlows 恒以
 * 本常量覆盖注册表同名项),防止业务定义冒名顶替自己的裁决器。
 *
 * validating 是引擎内瞬态:checks-pass / checks-fail 不是 exec 动词
 * (不声明在节点上,不进裁决面),由 meta 模块在 submit 后立即求值不变式并
 * 以 definition-submitted 事件落态;两条边以 LIFECYCLE_INTERNAL_EDGES 记录,
 * 仅供 terminal/可达性推导与文档(arch-brief §10 A.4)。
 */
import type { FlowDefinition, FlowEdge } from './types';

/** 保留 flow 名。 */
export const DEFINITION_LIFECYCLE = 'definition-lifecycle';

/** validating 的引擎内转移(非 exec 动词;A.4 原样)。 */
export const LIFECYCLE_INTERNAL_EDGES: readonly FlowEdge[] = [
  { from: 'validating', action: 'checks-pass', to: 'pending-approval' },
  { from: 'validating', action: 'checks-fail', to: 'draft' },
];

/** definition-lifecycle 自身(machine-as-JSON;guards 与 A.3 编辑动词清单一致)。 */
export const DEFINITION_LIFECYCLE_FLOW: FlowDefinition = {
  name: DEFINITION_LIFECYCLE,
  title: '定义生命周期',
  initial: 'draft',
  version: 1,
  nodes: [
    {
      name: 'draft',
      title: '草稿',
      actions: [
        {
          name: 'add-node',
          title: '加节点',
          guards: ['is-draft', 'node-not-exists'],
          fields: [
            { name: 'name', type: 'text', required: true, minLength: 1, semantics: 'intent' },
            { name: 'title', type: 'text', semantics: 'intent' },
          ],
          effect: [{ type: 'meta-edit', op: 'add-node' }],
        },
        {
          name: 'add-action',
          title: '加动作',
          guards: [
            'is-draft',
            'node-exists',
            'to-exists',
            'guards-registered',
            'effect-known',
            'action-not-exists',
          ],
          fields: [
            {
              name: 'node',
              type: 'text',
              required: true,
              minLength: 1,
              semantics: 'intent',
              description: '动作要声明到的节点名',
            },
            {
              name: 'action',
              type: 'json',
              required: true,
              semantics: 'intent',
              description: 'action-definition 全文(A.2 形状:name/title/to/guards/effect/fields)',
            },
          ],
          effect: [{ type: 'meta-edit', op: 'add-action' }],
        },
        {
          name: 'submit',
          title: '提交校验',
          guards: ['is-draft'],
          to: 'validating',
        },
      ],
    },
    { name: 'validating', title: '校验中', actions: [] },
    {
      name: 'pending-approval',
      title: '待批准',
      actions: [
        {
          name: 'approve',
          title: '批准',
          guards: ['actor-is-human'],
          to: 'active',
        },
        {
          name: 'reject',
          title: '驳回',
          guards: ['actor-is-human'],
          fields: [
            { name: 'reason', type: 'textarea', required: true, minLength: 1, semantics: 'intent' },
          ],
          to: 'rejected',
        },
      ],
    },
    {
      name: 'active',
      title: '活跃',
      actions: [
        {
          name: 'revise',
          title: '修订(开新草稿)',
          guards: ['is-active'],
          to: 'draft',
        },
        {
          name: 'deprecate',
          title: '废弃',
          guards: ['no-live-instances'],
          to: 'deprecated',
        },
      ],
    },
    { name: 'rejected', title: '已驳回', actions: [] },
    { name: 'deprecated', title: '已废弃', actions: [] },
  ],
};

/**
 * flow 注册表注入 lifecycle 常量(保留名恒覆盖)。
 * executeMeta 与 fold 都经它组装依赖:meta 裁决/重放永远用这份常量,
 * 调用方无须(也不能)自带 definition-lifecycle。
 */
export function withLifecycleFlows(
  flows: Readonly<Record<string, FlowDefinition>>,
): Record<string, FlowDefinition> {
  return { ...flows, [DEFINITION_LIFECYCLE]: DEFINITION_LIFECYCLE_FLOW };
}
