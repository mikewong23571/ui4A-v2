/**
 * machine-as-JSON 类型(UI4A 引擎的合同层形状)。
 *
 * 形状以 arch-brief §2(合同层)为准:action-definition 字段
 * `name/title/method/to/guards/requires-confirmation/effect/fields` 原样;
 * field-definition 为 RJSF v6 的直接输入(JSON Schema draft-07 派生自这里)。
 * 这些类型是纯数据(序列化友好),供 web/worker/引擎三方共用。
 */

/** 字段语义(arch-brief §2:四种)。 */
export type FieldSemantics = 'org-standard' | 'intent' | 'work-product' | 'elicitation';

/** 字段类型(RJSF 可渲染的表单控件种类)。 */
export type FieldType = 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'date';

/**
 * 字段值来源声明(铁律"事实永不发明":字段值必须声明来源)。
 * `kind` 覆盖 arch-brief 的六种来源:默认四态(静态/上下文/策略路由/词汇别名)、
 * 显式意图、起草+选择、引出、查找、效果产出。
 */
export interface FieldSource {
  kind:
    | 'static'
    | 'context'
    | 'policy-route'
    | 'vocabulary-alias'
    | 'intent'
    | 'proposal'
    | 'elicit'
    | 'lookup'
    | 'effect';
  /** context 来源的取值路径,如 "project.homeRegion"。 */
  from?: string;
  /** proposal 来源使用的 capability 名,如 "draft"。 */
  capability?: string;
  /** proposal 的草稿数(如 options: 3)。 */
  options?: number;
  /** 价值载体字段必须携带 human-required 选择声明(work-product)。 */
  selection?: 'human-required';
}

/** field-definition(arch-brief §2 A.2 原样 + select 的候选值)。 */
export interface FieldDefinition {
  name: string;
  type: FieldType;
  title?: string;
  description?: string;
  required?: boolean;
  semantics?: FieldSemantics;
  source?: FieldSource;
  /** select 类型的候选值。 */
  options?: string[];
  /** 默认值(静态来源)。 */
  default?: unknown;
  /** 校验失败时的去向:转澄清 session。 */
  'on-invalid'?: 'clarify';
  /** 引出策略(elicitation 字段)。 */
  elicit?: {
    strategy: string;
    'max-turns': number;
    timeout: string;
  };
}

/**
 * 参数/字段值出处(事件日志记录口径)。
 * 唯一定义在 @ui4a/shared(FieldValue 需要),此处 re-export 保持引擎公共面完整。
 */
import type { ParamOrigin } from '@ui4a/shared';

export type { ParamOrigin };

/**
 * 效果词汇表(T2 子集):
 * - transition:实例节点迁移(目标缺省取 action.to);
 * - set-field:字段赋值并记录出处;
 * - append:向集合资源追加新实例(生成 `类型:实例名` rel);
 * - spawn:能力效果(stub——T2 只产出事件记录,T3 接 Temporal)。
 */
export type EffectDefinition =
  | { type: 'transition'; to?: string }
  | {
      type: 'set-field';
      field: string;
      value: unknown;
      origin?: ParamOrigin;
    }
  | {
      type: 'append';
      /** 目标集合 rel,如 "articles"。 */
      collection: string;
      /** 新实例的资源类型(rel 前缀),缺省取 collection 单数化。 */
      'resource-type'?: string;
      /** 新实例受辖的 flow(如 "post-status")。 */
      flow?: string;
      /** 显式实例名。 */
      name?: string;
      /** 从请求参数取实例名(如 title → slug)。 */
      'name-from'?: string;
      /** 复制进新实例的字段白名单,缺省复制全部请求参数。 */
      fields?: string[];
      /** 新实例的初始节点(受对应 flow 管辖时),如 "published"。 */
      node?: string;
    }
  | {
      type: 'spawn';
      capability: string;
      bind?: Record<string, unknown>;
      'on-done'?: string;
    };

/** action-definition(arch-brief §2 A.2 原样;effect 允许数组以支持组合效果)。 */
export interface ActionDefinition {
  name: string;
  title: string;
  method?: 'POST';
  /** 目标节点(transition 缺省目标)。 */
  to?: string;
  /** guard 谓词名数组(按声明顺序求值,全部求值)。 */
  guards?: string[];
  /** 风险标注(策略性质,T3 才生效;谓词答"状态允许吗",标注答"是否需要确认")。 */
  'requires-confirmation'?: 'low' | 'medium' | 'high';
  effect?: EffectDefinition | EffectDefinition[];
  fields?: FieldDefinition[];
}

/** node-definition:节点 = 界面 + 动作声明集。 */
export interface NodeDefinition {
  name: string;
  title?: string;
  /** 节点级字段(进入该界面时采集)。 */
  fields?: FieldDefinition[];
  actions: ActionDefinition[];
}

/**
 * flow 定义 = machine-as-JSON(XState v5 运行时构造的真相源)。
 * T2 阶段为代码内 TS 常量;T4 起挪进事件日志。
 */
export interface FlowDefinition {
  name: string;
  title?: string;
  initial: string;
  nodes: NodeDefinition[];
  /** 流级字段(整个流程实例携带)。 */
  fields?: FieldDefinition[];
  version?: number | string;
}
