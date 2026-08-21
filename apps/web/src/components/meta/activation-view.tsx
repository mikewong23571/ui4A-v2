'use client';
/**
 * BIOS 激活详情面(T4 Phase C;spec 架构决定 7、铁律 5)。
 *
 * - checks 列表逐项呈现(submit 时引擎求值的激活不变式,失败附明细);
 * - 机械 diff 用内建 DefinitionDiffView(react-diff-view)呈现——审批者看到的
 *   diff 不经过被审批者提供的任何渲染器,渲染路径零 AI;
 * - approve/reject 是已声明动作:RJSF 渲染(reject reason 必填),提交走
 *   /_meta/api/exec 且恒 actor=human(审批不委托;agent 侧 approve 引擎层拒);
 * - 已决策(approved/rejected)是审计视图:投影无动作,本组件自然无按钮。
 */
import type { ActivationCheck, DefinitionDiff, SirenEntity } from '@ui4a/engine';

import { ActionRunner } from '../action-runner';
import { blockedForRenderer } from '../entity-view';
import { DefinitionDiffView } from './diff-render';
import { execMetaAction, useMetaEntity } from './meta-client';

/** properties.checks 的投影形状(ActivationCheck 列表)。 */
function checksOf(entity: SirenEntity): ActivationCheck[] {
  return Array.isArray(entity.properties.checks) ? (entity.properties.checks as ActivationCheck[]) : [];
}

function scalarPairs(entity: SirenEntity): [string, string][] {
  const skipped = new Set(['checks', 'diff']);
  return Object.entries(entity.properties)
    .filter(([key]) => !skipped.has(key))
    .map(([key, value]) => {
      if (Array.isArray(value)) return [key, value.map(String).join(', ')];
      if (value !== null && typeof value === 'object') return [key, JSON.stringify(value)];
      return [key, String(value)];
    });
}

export interface ActivationViewProps {
  id: string;
  entity: SirenEntity;
  /** 动作 exec 成功后的刷新回调(重拉激活实体)。 */
  onChanged?: () => void;
}

/** 激活详情(纯渲染;数据来自 /_meta/api/entity?rel=meta/activation:<id>)。 */
export function ActivationView({ id, entity, onChanged }: ActivationViewProps) {
  const properties = entity.properties;
  const checks = checksOf(entity);
  const diff = properties.diff as DefinitionDiff | undefined;
  const guardMap = new Map((entity['guard-results'] ?? []).map((entry) => [entry.action, entry]));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <nav className="mb-2 text-sm">
        <a href="/meta/activations" data-nav="meta-activations" className="text-blue-600 hover:underline">
          ← 激活队列
        </a>
      </nav>
      <h1 className="text-2xl font-semibold text-zinc-900">
        激活 {String(properties.id ?? id)}
      </h1>
      <p className="mt-1 text-xs text-zinc-500">
        {String(properties.flow ?? '')} · v{String(properties.version ?? '')} · 状态{' '}
        {String(properties.status ?? '')}
      </p>

      <section aria-label="属性" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">属性</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {scalarPairs(entity).map(([key, value]) => (
              <tr key={key} className="border-b border-zinc-100">
                <th scope="row" className="py-1 pr-4 text-left font-normal text-zinc-500">
                  {key}
                </th>
                <td className="py-1 break-all text-zinc-800">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="不变式检查" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">激活不变式({checks.length})</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="py-1 pr-4">检查</th>
              <th className="py-1 pr-4">结果</th>
              <th className="py-1">明细</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => (
              <tr key={check.name} className="border-b border-zinc-100 align-top">
                <td className="py-1 pr-4 text-zinc-800">{check.name}</td>
                <td className={`py-1 pr-4 ${check.pass ? 'text-green-700' : 'text-red-600'}`}>
                  {check.pass ? '通过' : '失败'}
                </td>
                <td className="py-1 break-all text-zinc-600">
                  {(check.detail ?? []).join('; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="机械 diff" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">
          机械 diff(基线 v{String(Number(properties.version ?? 1) - 1)} → 候选 v
          {String(properties.version ?? '')})
        </h2>
        {diff !== undefined ? (
          <DefinitionDiffView diff={diff} />
        ) : (
          <p className="mt-2 text-sm text-zinc-500">本激活无 diff 载荷(diff 字段引入前的旧日志)。</p>
        )}
      </section>

      {entity.actions.length > 0 && (
        <section aria-label="审批" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">审批(actor=human,不委托)</h2>
          <div className="space-y-4">
            {entity.actions.map((action) => {
              const guard = guardMap.get(action.name);
              return (
                <ActionRunner
                  key={`${id}:${action.name}:${JSON.stringify(action.fields)}`}
                  rel={`meta/activation:${id}`}
                  action={action}
                  blocked={blockedForRenderer(guard)}
                  blockReason={guard?.reason}
                  onExecuted={onChanged}
                  execFn={execMetaAction}
                />
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

/** 页面主体:取数状态机 + ActivationView(审批成功后重拉,审计视图自然出现)。 */
export function ActivationPageBody({ id }: { id: string }) {
  const { entity, state, refresh } = useMetaEntity(`meta/activation:${id}`);

  if (state === 'error' || state === 'missing') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-6">
        <nav className="mb-2 text-sm">
          <a href="/meta/activations" data-nav="meta-activations" className="text-blue-600 hover:underline">
            ← 激活队列
          </a>
        </nav>
        <p className="text-sm text-zinc-700">
          {state === 'missing' ? `激活 "${id}" 不存在(404)。` : '读取激活失败(服务不可用)。'}
        </p>
      </main>
    );
  }
  if (state === 'loading' || entity === null) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="text-sm text-zinc-500">加载中…</p>
      </main>
    );
  }
  return <ActivationView id={id} entity={entity} onChanged={refresh} />;
}
