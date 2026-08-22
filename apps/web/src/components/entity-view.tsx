'use client';
/**
 * EntityView:Siren 实体四件组装的通用渲染(properties / actions / links / guard-results,
 * 集合另渲染 entities[] 子实体)。:form runner 的零智能路径(arch-brief §7)——
 *
 * - 渲染的一切动作与链接都来自实体投影,本组件不含任何业务分支;
 * - renderer 的 navigate = 把合同 href(/api/entity?rel=…)换算成页面路由 /entity?rel=…;
 * - 谓词投影:guard-results.blocked → 对应动作 disabled + title 原因;
 * - exec 提交 rel 取实体自身 properties.rel(flow: 别名页落在实例 rel 上,直投不绕别名);
 * - T9 Phase C:分区卡片化(shadcn Card/Table/Badge),结构锚点不变
 *   (section[aria-label] / tbody tr / 成员 a / data-rel / data-nav)。
 * - T14 Phase A(#3/#4):属性表人话口径——title 投影不上表(h1 已呈现),
 *   字段值行的业务字段名映射中文标签(未知名原样,零发明),rel/flow/node
 *   合同标识保留机器名;properties.fields 作为 ActionRunner 的预填取值源。
 */
import type { GuardResultEntry, SirenEntity } from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

import { ActionRunner } from './action-runner';

/** 从合同 href 提取 rel(只认 /api/entity?rel=…;其余 href 无 rel 可提)。 */
function hrefToRel(href: string): string | null {
  const query = href.split('?')[1] ?? '';
  const match = /(?:^|&)rel=([^&]*)/.exec(query);
  return match === null ? null : decodeURIComponent(match[1].replace(/\+/g, ' '));
}

/** 页面导航 href(renderer 内路由 = /entity?rel=…)。 */
export function entityPageHref(rel: string): string {
  return `/entity?rel=${encodeURIComponent(rel)}`;
}

/**
 * 字段键值对的展示文本。properties.fields 是投影后的扁平形状
 * `{ name: value }`(engine fieldValues 已剥离开出处——出处只在事件日志里)。
 * 字段名经 fieldDisplayLabel 人话化(#3:机器字段名不直接上屏)。
 */
function fieldsSummary(fields: unknown): string {
  if (typeof fields !== 'object' || fields === null) return '';
  return Object.entries(fields as Record<string, unknown>)
    .map(([name, value]) => `${fieldDisplayLabel(name)}=${String(value)}`)
    .join(' · ');
}

/**
 * 属性表字段名的人话标签(T14 Phase A,#3):已知业务字段映射中文标题。
 * 未知名原样呈现——零发明:renderer 不替合同造标签;rel/flow/node 是合同
 * 标识(实体地址与状态机词汇),不在此表、保留机器名原样。
 */
const FIELD_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  title: '文章标题',
  category: '分类',
  tags: '标签',
  body: '正文',
};

/** 字段名的展示标签:已知业务字段取人话标题,未知原样。 */
function fieldDisplayLabel(name: string): string {
  return FIELD_DISPLAY_LABELS[name] ?? name;
}

/** 展平一个 properties 值:标量 → `key=value`;一层对象 → `key.sub=value`。 */
function flattenProperty(parts: string[], key: string, value: unknown): void {
  if (value === null || value === '' || typeof value === 'undefined') return;
  if (typeof value === 'object') {
    for (const [child, leaf] of Object.entries(value as Record<string, unknown>)) {
      if (leaf !== null && typeof leaf !== 'object' && leaf !== '') {
        parts.push(`${key}.${child}=${String(leaf)}`);
      }
    }
    return;
  }
  parts.push(`${key}=${String(value)}`);
}

/**
 * 集合成员条目的展示文本:零硬编码字段名,两条通用路径——
 * - 流程实例(fields 扁平值 + 节点);
 * - 通用回退(确认等非实例成员):无 fields/node 时按 properties 展平呈现
 *   (标量 + 一层对象,如 target-action=archive、proposed-by.actor=agent)。
 */
function memberSummary(sub: SirenEntity): string {
  const parts: string[] = [];
  if (typeof sub.properties.fields === 'object' && sub.properties.fields !== null) {
    for (const value of Object.values(sub.properties.fields as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) parts.push(String(value));
    }
  }
  if (sub.properties.node !== undefined) parts.push(String(sub.properties.node));
  if (parts.length === 0) {
    for (const [key, value] of Object.entries(sub.properties)) {
      if (key === 'rel') continue;
      flattenProperty(parts, key, value);
    }
  }
  return parts.filter((part) => part !== '').join(' · ');
}

/**
 * renderer 身份规则(arch-brief §3"同一个谓词的两个投影"):
 * Siren 投影的 guard-results 无 actor 上下文,actor-is-human 按引擎口径
 * fail-closed 为 false;但本 renderer 的 exec 恒以 actor=human 提交
 * (exec-client 固定身份)——该谓词在本视图恒过,真正的裁决仍在 exec
 * (agent 侧 approve 被 422 拒,I4)。仅当失败谓词**全部**是 actor-is-human
 * 时解除 disabled;状态类谓词(如 is-published)的 blocked 照旧呈现。
 */
export function blockedForRenderer(entry: GuardResultEntry | undefined): boolean {
  if (entry?.blocked !== true) return false;
  const failed = entry.guards.filter((evaluation) => !evaluation.pass);
  if (failed.length === 0) return true;
  return !failed.every((evaluation) => evaluation.name === 'actor-is-human');
}

export interface EntityViewProps {
  /** 页面请求的 rel(标题与缺省用途)。 */
  rel: string;
  entity: SirenEntity;
  /** 任一动作 exec 成功后的刷新回调(参数 = 实际提交的实例 rel)。 */
  onChanged?: (rel: string) => void;
}

export function EntityView({ rel, entity, onChanged }: EntityViewProps) {
  const guardMap = new Map((entity['guard-results'] ?? []).map((entry) => [entry.action, entry]));
  const execRel =
    typeof entity.properties.rel === 'string' && entity.properties.rel !== ''
      ? entity.properties.rel
      : rel;
  const heading =
    typeof entity.properties.title === 'string' && entity.properties.title !== ''
      ? entity.properties.title
      : rel;
  const members = entity.entities ?? [];
  // 实例字段值(properties.fields 扁平形状):同名动作字段预填的取值源(#4)。
  const prefillFields =
    typeof entity.properties.fields === 'object' && entity.properties.fields !== null
      ? (entity.properties.fields as Record<string, unknown>)
      : undefined;

  return (
    <div>
      <nav className="mb-2 text-sm">
        <a href="/" data-nav="home" className="text-primary hover:underline">
          ← 首页
        </a>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {rel}
        {entity.properties.node !== undefined ? ` · 节点 ${String(entity.properties.node)}` : ''}
      </p>

      <section aria-label="属性" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">属性</h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableBody>
              {Object.entries(entity.properties)
                // fields 单独成行(值人话化);title 是节点标题的纯展示投影,
                // h1 已呈现、不再上表(#3:与表单字段 title 撞名的根因)。
                .filter(([key]) => key !== 'fields' && key !== 'title')
                .map(([key, value]) => (
                  <TableRow key={key}>
                    <th
                      scope="row"
                      className="px-3 py-2 text-left align-top font-normal whitespace-nowrap text-muted-foreground"
                    >
                      {key}
                    </th>
                    <TableCell className="px-3 py-2 break-all whitespace-normal">
                      {String(value)}
                    </TableCell>
                  </TableRow>
                ))}
              {fieldsSummary(entity.properties.fields) !== '' && (
                <TableRow>
                  <th
                    scope="row"
                    className="px-3 py-2 text-left align-top font-normal whitespace-nowrap text-muted-foreground"
                  >
                    字段值
                  </th>
                  <TableCell className="px-3 py-2 break-all whitespace-normal">
                    {fieldsSummary(entity.properties.fields)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {entity.actions.length > 0 && (
        <section aria-label="动作" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">动作</h2>
          <div className="space-y-4">
            {entity.actions.map((action) => {
              const guard = guardMap.get(action.name);
              return (
                // key 含参数 schema:向导跨节点同名动作(如 next)的 schema 不同,
                // 换 key 强制换表单实例——RJSF 内部 formData 是组件态,实例被
                // React 复用会把前节点字段漏进本节点提交(additionalProperties:
                // false 拒绝)。每个 action schema 一个干净表单。
                <Card
                  key={`${execRel}:${action.name}:${JSON.stringify(action.fields)}`}
                  className="gap-3 p-4"
                >
                  <ActionRunner
                    rel={execRel}
                    action={action}
                    blocked={blockedForRenderer(guard)}
                    blockReason={guard?.reason}
                    onExecuted={onChanged}
                    prefill={prefillFields}
                  />
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {entity.links.length > 0 && (
        <section aria-label="链接" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">链接</h2>
          <Card className="gap-0 p-4">
            <ul className="space-y-1 text-sm">
              {entity.links.map((link) => {
                const target = hrefToRel(link.href);
                return (
                  <li key={`${link.rel.join('/')}:${link.href}`}>
                    <Badge variant="secondary" className="mr-2 font-mono font-normal">
                      {link.rel.join('/')}
                    </Badge>
                    {target !== null ? (
                      <a
                        href={entityPageHref(target)}
                        data-rel={target}
                        data-nav={link.rel[0]}
                        className="break-all text-primary hover:underline"
                      >
                        {target}
                      </a>
                    ) : (
                      <a
                        href={link.href}
                        data-nav="external"
                        className="break-all text-primary hover:underline"
                      >
                        {link.href}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}

      {members.length > 0 && (
        <section aria-label="成员" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">成员({members.length})</h2>
          <Card className="gap-0 p-4">
            <ul className="space-y-1 text-sm">
              {members.map((sub) => {
                const target = hrefToRel(sub.href ?? '') ?? String(sub.properties.rel ?? '');
                return (
                  <li key={target}>
                    <a
                      href={entityPageHref(target)}
                      data-rel={target}
                      data-nav="item"
                      className="break-all text-primary hover:underline"
                    >
                      {memberSummary(sub)}
                    </a>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
