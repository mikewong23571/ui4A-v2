'use client';
/**
 * ActionRunner:单个 Siren action 的 :form runner 渲染(arch-brief §7)。
 *
 * - 有 fields(参数 schema 属性非空)→ 可取消、可重开的 RJSF v6 inline 表单,
 *   schema 即 action.fields；打开/取消是零业务事件的 presentation interaction;
 *   (draft-07,引擎 schema.ts 派生;零硬编码字段——字段集完全由合同声明);
 * - 无 fields → 推送按钮；high-risk 先显式标记“已请求、未执行”，二次确认才
 *   POST /api/exec；业务提交身份固定 human/local-user/renderer;
 * - guard-results 的 blocked 投影为 disabled + title 原因(谓词两投影之一,另一投影给 agent);
 * - 拒绝如实呈现([layer] reason · detail),成功回调 onExecuted 供上层刷新实体;
 * - 铁律 3:本组件渲染的每个 form/button 都带 data-action=<已声明动作名>,
 *   不存在任何不映射已声明 action 的可提交元素;
 * - T9 Phase C:按钮走 shadcn Button;RJSF 只做模板层样式包装
 *   (FieldTemplate/字段错误样式 + 控件后代选择器外观),控件 id/原生
 *   select/textarea/label 关联/required 零改动。
 * - T14 Phase A(#4):prefill(当前实体实例字段值)同名预填 schema 声明的
 *   标量字段,用户确认而非重输;label 由 RJSF 缺省取 schema.title
 *   (field-definition 的人话标题),缺省回退机器名。
 */
import Form from '@rjsf/core';
import { ChevronDown } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { callerActionSchema, type SirenAction } from '@ui4a/engine';

import { Button } from '@/components/ui/button';

import type { ActionSubmit } from './actions/action-submit';
import { rjsfValidator } from './rjsf-validator';

/** 参数 schema 是否声明了字段(空 schema 走推送按钮路径)。 */
function schemaHasFields(schema: SirenAction['fields']): boolean {
  const properties = schema.properties as Record<string, unknown> | undefined;
  return properties !== undefined && Object.keys(properties).length > 0;
}

/**
 * 实例字段预填(T14 Phase A,#4):动作字段与当前实体 fields 同名时,以实例值
 * 作为表单初始值——用户确认而非重输。只取 schema 声明过、且实例值为标量
 * (string/number/boolean)的字段:合同外键交给 additionalProperties:false,
 * 非标量值不猜控件表示(零发明)。预填不改动值出处:提交仍以用户确认的
 * 参数为准,origin 由引擎按参数口径留痕。
 */
function initialFormData(
  schema: SirenAction['fields'],
  prefill: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (prefill === undefined) return undefined;
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (properties === undefined) return undefined;
  const data: Record<string, unknown> = {};
  for (const name of Object.keys(properties)) {
    const value = prefill[name];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      data[name] = value;
    }
  }
  return Object.keys(data).length > 0 ? data : undefined;
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

/** 触发键的展开指示:与 site-nav 系统菜单同款的 ChevronDown,展开时旋转 180°;
 *  纯图标不进可访问名,触发键可访问名 = 动作 title。 */
function TriggerChevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      aria-hidden="true"
      className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
    />
  );
}

export interface ActionRunnerProps {
  /** 提交目标实例 rel(集合页无动作;实例页取实体自身 rel)。 */
  rel: string;
  action: SirenAction;
  /** guard-results 注入:谓词投影 = disabled。 */
  blocked?: boolean;
  blockReason?: string;
  /** exec 成功后的刷新回调(参数 = 实际提交的 rel)。 */
  onExecuted?: (rel: string) => void;
  /** Host-owned, scope-aware submit adapter; the server remains the final judge. */
  submit: ActionSubmit;
  /** 当前实体的实例字段值(同名动作字段预填;缺省=无预填,如 _meta 动作)。 */
  prefill?: Record<string, unknown>;
  /** 危险操作的呈现分层(由 ActionGroup 按合同 requires-confirmation 派生)。 */
  tone?: 'danger';
}

export function ActionRunner({
  rel,
  action,
  blocked = false,
  blockReason,
  onExecuted,
  submit: submitAction,
  prefill,
  tone,
}: ActionRunnerProps) {
  const formSchema = callerActionSchema(action.fields);
  const hasFields = schemaHasFields(formSchema);
  const highRisk = action['requires-confirmation'] === 'high';
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // D50:参数表单单一默认收起(打开/关闭是零业务事件的 presentation interaction);
  // 阅读/任务面同默认,无双路径。打开后 prefill/焦点/两段式确认行为不变。
  const [interaction, setInteraction] = useState<'closed' | 'form' | 'requested' | 'executed'>(
    'closed',
  );
  const [pendingParams, setPendingParams] = useState<Record<string, unknown> | undefined>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const formRegionRef = useRef<HTMLDivElement>(null);
  const focusFormOnOpen = useRef(false);
  const formRegionId = useId();

  useEffect(() => {
    if (interaction !== 'form' || !focusFormOnOpen.current) return;
    focusFormOnOpen.current = false;
    const region = formRegionRef.current as unknown as {
      querySelector(selector: string): { focus(): void } | null;
    } | null;
    region?.querySelector('input:not([type="hidden"]), select, textarea')?.focus();
  }, [interaction]);

  /** 触发键 = 切换:展开中再点即收起(与 Esc/取消同一 restore 语义)。 */
  function openForm(): void {
    if (interaction === 'form') {
      restoreTrigger();
      return;
    }
    focusFormOnOpen.current = true;
    setInteraction('form');
  }

  function restoreTrigger(): void {
    setInteraction('closed');
    setPendingParams(undefined);
    setFailure(null);
    (triggerRef.current as unknown as { focus(): void } | null)?.focus();
  }

  function requestHighRisk(params?: Record<string, unknown>): void {
    setPendingParams(params);
    setFailure(null);
    setInteraction('requested');
  }

  async function submit(params?: Record<string, unknown>): Promise<void> {
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await submitAction({ rel, action, params });
      if (result.ok) {
        if (highRisk) setInteraction('executed');
        onExecuted?.(rel);
        return;
      }
      const detail = result.detail !== undefined ? ` · ${JSON.stringify(result.detail)}` : '';
      setFailure(`[${result.layer}] ${result.reason}${detail}`);
    } catch (error) {
      setFailure(`[network] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSubmitting(false);
    }
  }

  function handleFormSubmit(params?: Record<string, unknown>): void {
    if (highRisk) {
      requestHighRisk(params);
      return;
    }
    void submit(params);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape' || submitting || interaction === 'closed') return;
    event.preventDefault();
    event.stopPropagation();
    restoreTrigger();
  }

  const disabled = blocked || submitting;
  const hint = blocked ? blockReason : submitting ? '提交中…' : undefined;
  const toneClass =
    tone === 'danger'
      ? 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
      : undefined;
  const failureNode =
    failure !== null ? (
      <p role="alert" className="mt-1 text-xs text-destructive">
        {failure}
      </p>
    ) : null;
  const blockedNode =
    blocked && blockReason !== undefined ? (
      <p role="status" className="mt-1 text-xs text-muted-foreground">
        {blockReason}
      </p>
    ) : null;

  /** 可展开动作的触发键:request-risk 与 open-form 两路共用同一外观;
   *  chevron 只给 open-form(表单展开指示),request-risk 是两步确认,不加。 */
  function renderTrigger(
    presentationAction: string,
    open: boolean,
    onClick: () => void,
    controls?: string,
    chevron = false,
  ) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className={toneClass}
        data-presentation-action={presentationAction}
        data-nav={`presentation:${presentationAction}:${action.name}`}
        aria-controls={controls}
        aria-expanded={open}
        disabled={disabled}
        title={hint}
        onClick={onClick}
      >
        {action.title}
        {chevron && <TriggerChevron open={open} />}
      </Button>
    );
  }

  if (!hasFields && !highRisk) {
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
        {blockedNode}
        {failureNode}
      </div>
    );
  }

  if (!hasFields) {
    return (
      <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
        <div>
          {renderTrigger('request-risk', interaction === 'requested', () => requestHighRisk())}
        </div>
        {interaction === 'requested' && (
          <RiskRequest
            action={action}
            disabled={disabled}
            submitting={submitting}
            onConfirm={() => void submit(pendingParams)}
            onCancel={restoreTrigger}
          />
        )}
        {interaction === 'executed' && <ExecutedStatus action={action} />}
        {blockedNode}
        {failureNode}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <div>{renderTrigger('open-form', interaction === 'form', openForm, formRegionId, true)}</div>
      {interaction === 'form' && (
        <div ref={formRegionRef} id={formRegionId} data-action={action.name}>
          <Form
            idPrefix={`action_${rel}_${action.name}_${formRegionId}`.replaceAll(
              /[^A-Za-z0-9_-]/g,
              '_',
            )}
            schema={formSchema}
            validator={rjsfValidator}
            // 实例字段预填(#4):同名标量字段以实例值起手,提交仍以用户确认的参数为准。
            formData={initialFormData(formSchema, prefill)}
            templates={{
              FieldTemplate: RjsfFieldTemplate,
              FieldErrorTemplate: RjsfFieldErrorTemplate,
            }}
            className={FORM_CONTROL_STYLES}
            // 只提交当前 action schema 声明过的字段(铁律 3 的提交面):
            // omitExtraData 剥离一切 schema 外键,liveOmit 在编辑期即保持剥离。
            omitExtraData
            liveOmit
            onSubmit={({ formData }) =>
              handleFormSubmit(formData as Record<string, unknown> | undefined)
            }
          >
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                size="sm"
                data-action={action.name}
                disabled={disabled}
                title={hint}
              >
                {action.title}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-presentation-action="cancel-form"
                data-nav={`presentation:cancel-form:${action.name}`}
                disabled={submitting}
                onClick={restoreTrigger}
              >
                取消
              </Button>
            </div>
          </Form>
        </div>
      )}
      {interaction === 'requested' && (
        <RiskRequest
          action={action}
          disabled={disabled}
          submitting={submitting}
          onConfirm={() => void submit(pendingParams)}
          onCancel={restoreTrigger}
        />
      )}
      {interaction === 'executed' && <ExecutedStatus action={action} />}
      {blockedNode}
      {failureNode}
    </div>
  );
}

function RiskRequest({
  action,
  disabled,
  submitting,
  onConfirm,
  onCancel,
}: {
  action: SirenAction;
  disabled: boolean;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p role="status">已请求“{action.title}”，尚未执行。</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          data-action={action.name}
          disabled={disabled}
          onClick={onConfirm}
        >
          确认并执行{action.title}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-presentation-action="cancel-request"
          data-nav={`presentation:cancel-request:${action.name}`}
          disabled={submitting}
          onClick={onCancel}
        >
          取消请求
        </Button>
      </div>
    </div>
  );
}

function ExecutedStatus({ action }: { action: SirenAction }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      已执行“{action.title}”。
    </p>
  );
}
