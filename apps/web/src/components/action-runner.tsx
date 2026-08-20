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
 *   不存在任何不映射已声明 action 的可提交元素。
 */
import Form from '@rjsf/core';
import { useState } from 'react';

import type { SirenAction } from '@ui4a/engine';

import { execAction } from './exec-client';
import { rjsfValidator } from './rjsf-validator';

/** 参数 schema 是否声明了字段(空 schema 走推送按钮路径)。 */
function schemaHasFields(schema: SirenAction['fields']): boolean {
  const properties = schema.properties as Record<string, unknown> | undefined;
  return properties !== undefined && Object.keys(properties).length > 0;
}

export interface ActionRunnerProps {
  /** 提交目标实例 rel(集合页无动作;实例页取实体自身 rel)。 */
  rel: string;
  action: SirenAction;
  /** guard-results 注入:谓词投影 = disabled。 */
  blocked?: boolean;
  blockReason?: string;
  /** exec 成功后的刷新回调。 */
  onExecuted?: () => void;
}

export function ActionRunner({
  rel,
  action,
  blocked = false,
  blockReason,
  onExecuted,
}: ActionRunnerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(params?: Record<string, unknown>): Promise<void> {
    setSubmitting(true);
    setFailure(null);
    const result = await execAction({ rel, action: action.name, params });
    setSubmitting(false);
    if (result.ok) {
      onExecuted?.();
      return;
    }
    const detail = result.detail !== undefined ? ` · ${JSON.stringify(result.detail)}` : '';
    setFailure(`[${result.layer}] ${result.reason}${detail}`);
  }

  const disabled = blocked || submitting;
  const hint = blocked ? blockReason : submitting ? '提交中…' : undefined;
  const failureNode =
    failure !== null ? (
      <p role="alert" className="mt-1 text-xs text-red-600">
        {failure}
      </p>
    ) : null;

  if (!schemaHasFields(action.fields)) {
    return (
      <div data-action={action.name} className="flex flex-col">
        <button
          type="button"
          data-action={action.name}
          disabled={disabled}
          title={hint}
          onClick={() => void submit()}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {action.title}
        </button>
        {failureNode}
      </div>
    );
  }

  return (
    <div data-action={action.name} className="flex flex-col">
      <Form
        schema={action.fields}
        validator={rjsfValidator}
        onSubmit={({ formData }) => void submit(formData as Record<string, unknown> | undefined)}
      >
        <button
          type="submit"
          data-action={action.name}
          disabled={disabled}
          title={hint}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {action.title}
        </button>
      </Form>
      {failureNode}
    </div>
  );
}
