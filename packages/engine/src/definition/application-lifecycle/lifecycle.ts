/**
 * application-lifecycle(T52 Phase 3;D71.2/D71.6):受治理应用自身的状态机,
 * 以 machine-as-JSON 常量自举——镜像 definition-lifecycle 的纪律:停用动词
 * deprecate 声明在 active 节点,过**同一个** judge(声明→guard→schema)与
 * 同一套效果词汇表(有 to 无 effect 时补 transition)。
 *
 * reserving:`application-lifecycle` 是保留 flow 名(withLifecycleFlows 恒以
 * 本常量覆盖注册表同名项),防止业务定义冒名顶替自己的裁决器。
 *
 * default 地板(D71.6):application-not-default guard 在 guard 层拒绝
 * meta/application:default 的 deprecate(拒绝即数据 I6,由调用方入日志),
 * 裁决层无特判分支。human-only(actor-is-human)+ requires-confirmation
 * 'high' 与 definition-lifecycle 的 approve/reject 同口径(内置/随附 Cedar
 * 策略对 human 直通,agent 先被 guard 拒;更严策略下的挂起语义见
 * confirmation 模块)。reason 可选:停用理由留痕不设门槛。
 */
import type { FlowDefinition } from '../../core/types';

/** 保留 flow 名。 */
export const APPLICATION_LIFECYCLE = 'application-lifecycle';

/** application-lifecycle 自身(machine-as-JSON;seeded 即 active)。 */
export const APPLICATION_LIFECYCLE_FLOW: FlowDefinition = {
  name: APPLICATION_LIFECYCLE,
  title: '应用生命周期',
  initial: 'active',
  version: 1,
  nodes: [
    {
      name: 'active',
      title: '活跃',
      actions: [
        {
          name: 'deprecate',
          title: '停用',
          guards: ['actor-is-human', 'application-not-default'],
          'requires-confirmation': 'high',
          fields: [{ name: 'reason', type: 'textarea', semantics: 'intent' }],
          to: 'deprecated',
        },
      ],
    },
    { name: 'deprecated', title: '已停用', actions: [] },
  ],
};
