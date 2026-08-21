/**
 * machine-as-JSON 类型(UI4A 引擎的合同层形状)。
 *
 * T4 起类型本体迁入 @ui4a/shared(definition.ts):定义平面需要把 flow 定义
 * 作为数据存进快照、shared 谓词要读工作副本(见 shared/src/definition.ts
 * 头注)。此处 re-export 保持引擎公共面与既有 `from './types'` 导入不变
 * (机械适配,零行为差异)。
 */
export type {
  FieldSemantics,
  FieldType,
  FieldSource,
  FieldDefinition,
  EffectDefinition,
  MetaEditOp,
  ActionDefinition,
  NodeDefinition,
  FlowDefinition,
  ApplicationDefinition,
  FlowEdge,
  DefinitionStatus,
  DefinitionEntry,
  ActivationCheck,
  DefinitionDiff,
} from '@ui4a/shared';

/** 定义语言注册表常量(字段/效果类型清单;meta/registries 的运行时子集)。 */
export { KNOWN_FIELD_TYPES, KNOWN_EFFECT_TYPES } from '@ui4a/shared';

/**
 * 参数/字段值出处(事件日志记录口径)。
 * 唯一定义在 @ui4a/shared(FieldValue 需要),此处 re-export 保持引擎公共面完整。
 */
export type { ParamOrigin } from '@ui4a/shared';
