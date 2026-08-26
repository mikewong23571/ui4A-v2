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

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { ActionRunner } from '../action-runner';
import { blockedForRenderer } from '../actions/action-group';
import { createDirectActionSubmit } from '../actions/action-submit';
import { DefinitionDiffView } from './diff-render';
import { execMetaAction, useMetaEntity } from './meta-client';

/** properties.checks 的投影形状(ActivationCheck 列表)。 */
function checksOf(entity: SirenEntity): ActivationCheck[] {
  return Array.isArray(entity.properties.checks)
    ? (entity.properties.checks as ActivationCheck[])
    : [];
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
    <div>
      <nav className="mb-2 text-sm">
        <a
          href="/meta/activations"
          data-nav="meta-activations"
          className="text-primary hover:underline"
        >
          ← 激活队列
        </a>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">激活 {String(properties.id ?? id)}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {String(properties.flow ?? '')} · v{String(properties.version ?? '')} · 状态{' '}
        {String(properties.status ?? '')}
      </p>

      <section aria-label="属性" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">属性</h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableBody>
              {scalarPairs(entity).map(([key, value]) => (
                <TableRow key={key}>
                  <th
                    scope="row"
                    className="px-3 py-2 text-left align-top font-normal whitespace-nowrap text-muted-foreground"
                  >
                    {key}
                  </th>
                  <TableCell className="px-3 py-2 break-all whitespace-normal">{value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-label="不变式检查" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">激活不变式({checks.length})</h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3 text-muted-foreground">检查</TableHead>
                <TableHead className="px-3 text-muted-foreground">结果</TableHead>
                <TableHead className="px-3 text-muted-foreground">明细</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((check) => (
                <TableRow key={check.name}>
                  <TableCell className="px-3 py-2 align-top">{check.name}</TableCell>
                  <TableCell className="px-3 py-2 align-top">
                    <Badge variant={check.pass ? 'secondary' : 'destructive'}>
                      {check.pass ? '通过' : '失败'}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-3 py-2 align-top break-all whitespace-normal text-muted-foreground">
                    {(check.detail ?? []).join('; ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-label="机械 diff" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">
          机械 diff(基线 v{String(Number(properties.version ?? 1) - 1)} → 候选 v
          {String(properties.version ?? '')})
        </h2>
        <Card className="gap-0 overflow-x-auto p-4">
          {diff !== undefined ? (
            <DefinitionDiffView diff={diff} />
          ) : (
            <p className="text-sm text-muted-foreground">
              本激活无 diff 载荷(diff 字段引入前的旧日志)。
            </p>
          )}
        </Card>
      </section>

      {entity.actions.length > 0 && (
        <section aria-label="审批" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">审批(actor=human,不委托)</h2>
          <div className="space-y-4">
            {entity.actions.map((action) => {
              const guard = guardMap.get(action.name);
              return (
                <Card
                  key={`${id}:${action.name}:${JSON.stringify(action.fields)}`}
                  className="gap-3 p-4"
                >
                  <ActionRunner
                    rel={`meta/activation:${id}`}
                    action={action}
                    blocked={blockedForRenderer(guard)}
                    blockReason={guard?.reason}
                    onExecuted={onChanged}
                    submit={createDirectActionSubmit(execMetaAction)}
                  />
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** 页面主体:取数状态机 + ActivationView(审批成功后重拉,审计视图自然出现)。 */
export function ActivationPageBody({ id }: { id: string }) {
  const { entity, state, refresh } = useMetaEntity(`meta/activation:${id}`);

  if (state === 'error' || state === 'missing') {
    return (
      <div>
        <nav className="mb-2 text-sm">
          <a
            href="/meta/activations"
            data-nav="meta-activations"
            className="text-primary hover:underline"
          >
            ← 激活队列
          </a>
        </nav>
        <p className="text-sm">
          {state === 'missing' ? `激活 "${id}" 不存在(404)。` : '读取激活失败(服务不可用)。'}
        </p>
      </div>
    );
  }
  if (state === 'loading' || entity === null) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }
  return <ActivationView id={id} entity={entity} onChanged={refresh} />;
}
