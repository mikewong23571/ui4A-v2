'use client';
/**
 * ActionRunner:单个 Siren action 的 :form runner 渲染(arch-brief §7)。
 *
 * - 有 fields(参数 schema 属性非空)→ RJSF v6 表单,schema 即 action.fields
 *   (draft-07,引擎 schema.ts 派生;零硬编码字段——字段集完全由合同声明);
 * - 无 fields → 推送按钮;两条路径都 POST /api/exec,身份固定 human/local-user/renderer;
 * - guard-results 的 blocked 投影为 disabled + title 原因(谓词两投影之一,另一投影给 agent);
 * - 拒绝如实呈现([layer] reason · detail),成功回调 onExecuted 供上层刷新实体;
 * - 铁律 3:本组件渲染的每个 form/button 都带 data-action=<已声明动作名>,
 *   不存在任何不映射已声明 action 的可提交元素;
 * - T9 Phase C:按钮走 shadcn Button;RJSF 只做模板层样式包装
 *   (FieldTemplate/字段错误样式 + 控件后代选择器外观),控件 id/原生
 *   select/textarea/label 关联/required 零改动。
 */
import Form from '@rjsf/core';
import { useState, type ComponentType, type ReactNode } from 'react';

import type { SirenAction } from '@ui4a/engine';

import { Button } from '@/components/ui/button';

import { execAction } from './exec-client';
import type { ExecClientResult } from './exec-client';
import { rjsfValidator } from './rjsf-validator';

/** 参数 schema 是否声明了字段(空 schema 走推送按钮路径)。 */
function schemaHasFields(schema: SirenAction['fields']): boolean {
  const properties = schema.properties as Record<string, unknown> | undefined;
  return properties !== undefined && Object.keys(properties).length > 0;
}

// ---- RJSF 模板层样式包装(T9 Phase C)-------------------------------------------
// 只包装外观:控件 id(#root_*)/原生 select/textarea/label 关联/required 全由
// RJSF 缺省模板与控件链生成,此处零改动;结构差异仅限 label/错误的样式类与
// 字段间距容器。props 取最小结构类型(@rjsf/utils 非直接依赖,pnpm 严格解析
// 下不可 import;字段口径与 @rjsf/utils v6 的 FieldTemplateProps 对齐)。

/** FieldTemplate 包装所需的最小 props(与 v6 FieldTemplateProps 的使用面一致)。 */
interface RjsfFieldTemplateProps {
  id: string;
  label?: string;
  required?: boolean;
  hidden?: boolean;
  displayLabel?: boolean;
  description?: ReactNode;
  errors?: ReactNode;
  help?: ReactNode;
  children?: ReactNode;
  uiSchema?: { 'ui:widget'?: unknown };
  registry: {
    templates: {
      WrapIfAdditionalTemplate: ComponentType<RjsfFieldTemplateProps>;
    };
  };
}

/** FieldErrorTemplate 包装所需的最小 props(fieldPathId 取 $id,同 errorId 口径)。 */
interface RjsfFieldErrorTemplateProps {
  errors?: ReactNode[];
  fieldPathId: { $id: string };
}

/**
 * FieldTemplate 包装:与 RJSF 缺省实现同序(label → description → 控件 →
 * errors → help),只加样式类;WrapIfAdditional 经 registry 取缺省模板
 * (additionalProperties 的键编辑行为不变)。
 */
function RjsfFieldTemplate(props: RjsfFieldTemplateProps) {
  const {
    id,
    label,
    children,
    errors,
    help,
    description,
    hidden,
    required,
    displayLabel,
    registry,
    uiSchema,
  } = props;
  if (hidden) {
    return <div className="hidden">{children}</div>;
  }
  // 缺省实现判 getUiOptions(uiSchema).widget === 'checkbox';本站零 uiSchema,
  // 直读 ui:widget 即等价(布尔字段的 label 由控件模板自渲染)。
  const isCheckbox = uiSchema?.['ui:widget'] === 'checkbox';
  const WrapIfAdditional = registry.templates.WrapIfAdditionalTemplate;
  return (
    <WrapIfAdditional {...props}>
      <div className="mb-4 flex flex-col gap-1.5">
        {displayLabel === true && !isCheckbox && label !== undefined && label !== '' && (
          <label htmlFor={id} className="text-sm leading-none font-medium">
            {label}
            {required === true && <span className="text-destructive"> *</span>}
          </label>
        )}
        {displayLabel === true && description !== undefined ? description : null}
        {children}
        {errors}
        {help}
      </div>
    </WrapIfAdditional>
  );
}

/** 字段级校验错误:如实逐条呈现(与缺省同文本),仅样式令牌化。 */
function RjsfFieldErrorTemplate(props: RjsfFieldErrorTemplateProps) {
  const { errors = [], fieldPathId } = props;
  if (errors.length === 0) return null;
  return (
    <ul id={`${fieldPathId.$id}__error`} className="list-disc pl-4 text-xs text-destructive">
      {errors
        .filter((error) => error !== null && error !== '')
        .map((error, index) => (
          // 错误条目无稳定键源(文本可重复),与 RJSF 缺省实现同用下标键。
          <li key={index}>{error}</li>
        ))}
    </ul>
  );
}

/** 原生控件(input/select/textarea)的外观令牌:结构零改动,仅经后代选择器上样式。 */
const FORM_CONTROL_STYLES = [
  '[&_input:not([type=checkbox])]:w-full [&_input:not([type=checkbox])]:rounded-md [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-input [&_input:not([type=checkbox])]:bg-background [&_input:not([type=checkbox])]:px-2 [&_input:not([type=checkbox])]:py-1 [&_input:not([type=checkbox])]:text-sm [&_input:not([type=checkbox])]:shadow-xs',
  '[&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-background [&_select]:px-2 [&_select]:py-1 [&_select]:text-sm [&_select]:shadow-xs',
  '[&_textarea]:w-full [&_textarea]:min-h-20 [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-background [&_textarea]:px-2 [&_textarea]:py-1 [&_textarea]:text-sm [&_textarea]:shadow-xs',
  '[&_input]:focus-visible:border-ring [&_input]:focus-visible:ring-[3px] [&_input]:focus-visible:ring-ring/50 [&_input]:focus-visible:outline-none',
  '[&_select]:focus-visible:border-ring [&_select]:focus-visible:ring-[3px] [&_select]:focus-visible:ring-ring/50 [&_select]:focus-visible:outline-none',
  '[&_textarea]:focus-visible:border-ring [&_textarea]:focus-visible:ring-[3px] [&_textarea]:focus-visible:ring-ring/50 [&_textarea]:focus-visible:outline-none',
].join(' ');

/** 提交函数形态(缺省业务 /api/exec;BIOS 面注入 /_meta/api/exec)。 */
export type ExecFn = (input: {
  rel: string;
  action: string;
  params?: Record<string, unknown>;
}) => Promise<ExecClientResult>;

export interface ActionRunnerProps {
  /** 提交目标实例 rel(集合页无动作;实例页取实体自身 rel)。 */
  rel: string;
  action: SirenAction;
  /** guard-results 注入:谓词投影 = disabled。 */
  blocked?: boolean;
  blockReason?: string;
  /** exec 成功后的刷新回调(参数 = 实际提交的 rel)。 */
  onExecuted?: (rel: string) => void;
  /** 提交函数(缺省业务端 /api/exec;_meta 站点动作注入 meta 客户端)。 */
  execFn?: ExecFn;
}

export function ActionRunner({
  rel,
  action,
  blocked = false,
  blockReason,
  onExecuted,
  execFn = execAction,
}: ActionRunnerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(params?: Record<string, unknown>): Promise<void> {
    setSubmitting(true);
    setFailure(null);
    const result = await execFn({ rel, action: action.name, params });
    setSubmitting(false);
    if (result.ok) {
      onExecuted?.(rel);
      return;
    }
    const detail = result.detail !== undefined ? ` · ${JSON.stringify(result.detail)}` : '';
    setFailure(`[${result.layer}] ${result.reason}${detail}`);
  }

  const disabled = blocked || submitting;
  const hint = blocked ? blockReason : submitting ? '提交中…' : undefined;
  const failureNode =
    failure !== null ? (
      <p role="alert" className="mt-1 text-xs text-destructive">
        {failure}
      </p>
    ) : null;

  if (!schemaHasFields(action.fields)) {
    return (
      // data-action 只在可提交元素本体(铁律 3 背书唯一挂点;外包装不带,
      // 避免 e2e/探针命中容器时落点在按钮之外)。
      <div className="flex flex-col">
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-action={action.name}
            disabled={disabled}
            title={hint}
            onClick={() => void submit()}
          >
            {action.title}
          </Button>
        </div>
        {failureNode}
      </div>
    );
  }

  return (
    // form 路径:RJSF 的 <form> 元素本身不带背书属性(库不转发 data-*),
    // 背书挂在包裹容器上(铁律 3 审计 closest('[data-action]') 口径)。
    <div data-action={action.name} className="flex flex-col">
      <Form
        schema={action.fields}
        validator={rjsfValidator}
        templates={{ FieldTemplate: RjsfFieldTemplate, FieldErrorTemplate: RjsfFieldErrorTemplate }}
        className={FORM_CONTROL_STYLES}
        // 只提交当前 action schema 声明过的字段(铁律 3 的提交面):
        // omitExtraData 剥离一切 schema 外键,liveOmit 在编辑期即保持剥离。
        omitExtraData
        liveOmit
        onSubmit={({ formData }) => void submit(formData as Record<string, unknown> | undefined)}
      >
        <Button type="submit" size="sm" data-action={action.name} disabled={disabled} title={hint}>
          {action.title}
        </Button>
      </Form>
      {failureNode}
    </div>
  );
}
