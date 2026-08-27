/**
 * Siren 投影公共类型:实体/动作/链接/guard-results 形状与投影依赖(arch-brief §2)。
 *
 * properties / actions / links / guard-results;集合实体经 entities[] 携带
 * 子实体(带直达 href,B2 的"经子实体链接直达 post:post-welcome"即靠它)。
 * href 默认相对路径(/api/exec、/api/entity?rel=…),
 * HTTP 层以 baseHref 注入本源前缀——引擎不知道自己被挂在哪。
 */
import type { GuardEvaluation, GuardRegistry } from '@ui4a/shared';

import type { DefinitionVersionTable } from '../../execution/judge';
import type { ActionDefinition, FieldDefinition, FlowDefinition } from '../../core/types';

export interface SirenFieldPresentation {
  /** Binding path into this Siren entity. It is a reference, never a copied field value. */
  path: string;
  title: string;
  role?: NonNullable<FieldDefinition['presentation']>['role'];
  contentMediaType?: string;
}

/** Siren action(字段为参数 JSON Schema——RJSF 与 agent 共同输入)。 */
export interface SirenAction {
  name: string;
  title: string;
  method: string;
  href: string;
  fields: Record<string, unknown>;
  'requires-confirmation'?: 'low' | 'medium' | 'high';
  submission?: ActionDefinition['submission'];
}

/** guard 求值结果逐项注入的条目(每个 action 一条,含 blocked 原因)。
 *  投影口径:guard 以空参数求值——依赖提交参数的谓词(如 title-not-taken)在投影中
 *  恒过;真正裁决以 exec 时的 guard 层为准,拒绝仍会带原因回流(拒绝即教育)。 */
export interface GuardResultEntry {
  action: string;
  blocked: boolean;
  reason?: string;
  guards: GuardEvaluation[];
}

export interface SirenLink {
  rel: string[];
  href: string;
  /** Human-facing link label from contract data (Siren link.title); renderers prefer it over the raw rel. */
  title?: string;
}

/** Siren 实体(子实体额外带 rel 与直达 href)。 */
export interface SirenEntity {
  class: string[];
  rel?: string[];
  href?: string;
  properties: Record<string, unknown>;
  actions: SirenAction[];
  links: SirenLink[];
  'guard-results'?: GuardResultEntry[];
  entities?: SirenEntity[];
}

export interface ProjectDeps {
  flows: Readonly<Record<string, FlowDefinition>>;
  guards: GuardRegistry;
  /** 按出生版本解析的注册表(T4 Phase B,与 JudgeDeps 同口径;缺省回退 flows)。 */
  versions?: DefinitionVersionTable;
  /** href 前缀(如 "http://localhost:3100" 或 "/_meta");缺省相对路径。 */
  baseHref?: string;
}
