import type { ComponentType, ReactNode } from 'react';

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
export function RjsfFieldTemplate(props: RjsfFieldTemplateProps) {
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
export function RjsfFieldErrorTemplate(props: RjsfFieldErrorTemplateProps) {
  const { errors = [], fieldPathId } = props;
  if (errors.length === 0) return null;
  return (
    <ul
      id={`${fieldPathId.$id}__error`}
      role="alert"
      aria-live="polite"
      className="list-disc pl-4 text-xs text-destructive"
    >
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
export const FORM_CONTROL_STYLES = [
  '[&_input:not([type=checkbox])]:w-full [&_input:not([type=checkbox])]:rounded-md [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-input [&_input:not([type=checkbox])]:bg-background [&_input:not([type=checkbox])]:px-2 [&_input:not([type=checkbox])]:py-1 [&_input:not([type=checkbox])]:text-sm [&_input:not([type=checkbox])]:shadow-xs',
  '[&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-input [&_select]:bg-background [&_select]:px-2 [&_select]:py-1 [&_select]:text-sm [&_select]:shadow-xs',
  '[&_textarea]:w-full [&_textarea]:min-h-20 [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-input [&_textarea]:bg-background [&_textarea]:px-2 [&_textarea]:py-1 [&_textarea]:text-sm [&_textarea]:shadow-xs',
  '[&_input]:focus-visible:border-ring [&_input]:focus-visible:ring-[3px] [&_input]:focus-visible:ring-ring/50 [&_input]:focus-visible:outline-none',
  '[&_select]:focus-visible:border-ring [&_select]:focus-visible:ring-[3px] [&_select]:focus-visible:ring-ring/50 [&_select]:focus-visible:outline-none',
  '[&_textarea]:focus-visible:border-ring [&_textarea]:focus-visible:ring-[3px] [&_textarea]:focus-visible:ring-ring/50 [&_textarea]:focus-visible:outline-none',
].join(' ');
