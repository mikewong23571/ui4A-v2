'use client';
/**
 * EntityView:Siren 实体四件组装的通用渲染(properties / actions / links / guard-results,
 * 集合另渲染 entities[] 子实体)。:form runner 的零智能路径(arch-brief §7)——
 *
 * - 渲染的一切动作与链接都来自实体投影,本组件不含任何业务分支;
 * - renderer 的 navigate = 把合同 href(/api/entity?rel=…)换算成页面路由 /entity?rel=…;
 * - 谓词投影:guard-results 的阻断原因在控件下方以 status 语义可见呈现
 *   (T28 一等动作口径;title 只作冗余提示);
 * - exec 提交 rel 取实体自身 properties.rel(flow: 别名页落在实例 rel 上,直投不绕别名);
 * - T9 Phase C:分区卡片化(shadcn Card/Table),结构锚点不变
 *   (section[aria-label] / tbody tr / 成员 a / data-rel / data-nav)。
 * - T40 Phase C(F-02/F-03):状态词与字段全部消费合同数据——
 *   h1 取 properties.identity(实例身份),属性表状态行显示节点中文标题
 *   (properties.title,与列表成员同源),node 机器 id 退守 RawContractDrawer;
 *   字段区按 properties.presentation.fields 声明逐字段独立成行(合同 title),
 *   未声明/未填字段不渲染空壳;T14 的字段名字典(FIELD_DISPLAY_LABELS)已拆除,
 *   标签唯一来源是合同 title。properties.fields 仍作为 ActionRunner 的预填取值源。
 */
import type { SirenEntity } from '@ui4a/engine';

import { Card } from '@/components/ui/card';
import { entityPageHref } from '@/presence/navigation';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

import { ActionGroup } from './actions/action-group';
import { createDirectActionSubmit, observedActionClientParams } from './actions/action-submit';
import { execAction } from './exec-client';
import { hrefToRel } from './contract-href';
import { RawContractDrawer } from './canvas/raw-contract-drawer';

export { entityPageHref } from '@/presence/navigation';

/** 字段分层顺序(T40 F-03):identity → primary-content → metadata;未列 role 殿后。 */
const FIELD_ROLE_ORDER: Readonly<Record<string, number>> = {
  identity: 0,
  'primary-content': 1,
  metadata: 2,
};

interface DeclaredField {
  path: string;
  title?: string;
  role?: string;
  overview?: boolean;
}

/** 按 path 读实体值(声明路径是 'properties.…' 引用,值不复制)。 */
function readPathValue(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** presentation.fields 声明数组(非数组/非对象条目跳过,零发明)。 */
function declaredFieldsOf(entity: SirenEntity): DeclaredField[] {
  const presentation = entity.properties.presentation;
  if (typeof presentation !== 'object' || presentation === null || Array.isArray(presentation)) {
    return [];
  }
  const fields = (presentation as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    if (typeof field !== 'object' || field === null || Array.isArray(field)) return [];
    const { path, title, role, overview } = field as Record<string, unknown>;
    if (typeof path !== 'string' || path === '') return [];
    return [
      {
        path,
        ...(typeof title === 'string' && title !== '' ? { title } : {}),
        ...(typeof role === 'string' && role !== '' ? { role } : {}),
        ...(overview === true ? { overview: true as const } : {}),
      },
    ];
  });
}

/** 字段标签唯一来源 = 合同 title;缺席回退 path 尾段(零发明)。 */
function fieldLabel(field: DeclaredField): string {
  return field.title ?? field.path.split('.').at(-1) ?? field.path;
}

/** 实体页字段区:按声明遍历,已填字段按 role 顺序独立成行(同 role 声明序)。 */
function declaredFieldRows(entity: SirenEntity): Array<{ label: string; value: unknown }> {
  const byRole = new Map<string, DeclaredField[]>();
  for (const field of declaredFieldsOf(entity)) {
    const value = readPathValue(entity, field.path);
    if (value === undefined || value === null || value === '') continue;
    const role = field.role ?? 'metadata';
    const list = byRole.get(role) ?? [];
    list.push(field);
    byRole.set(role, list);
  }
  const rows: Array<{ label: string; value: unknown }> = [];
  for (const [, list] of [...byRole.entries()].sort(
    ([left], [right]) => (FIELD_ROLE_ORDER[left] ?? 99) - (FIELD_ROLE_ORDER[right] ?? 99),
  )) {
    for (const field of list) {
      rows.push({ label: fieldLabel(field), value: readPathValue(entity, field.path) });
    }
  }
  return rows;
}

const PROPERTY_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  'target-rel': '目标对象',
  'target-action': '待执行动作',
  params: '动作参数',
  'proposed-by': '提议者',
  channel: '提议渠道',
  'risk-level': '风险等级',
  policy: '确认策略',
  'policy-reason': '挂起原因',
  status: '状态',
  notified: '通知已送达',
};

function propertyDisplayLabel(name: string): string {
  return PROPERTY_DISPLAY_LABELS[name] ?? name;
}

function propertyDisplayValue(name: string, value: unknown): string {
  if (name === 'params' && typeof value === 'object' && value !== null) {
    // T40:params 内嵌键原样呈现(零字段名字典);未知键原样,不替合同造标签。
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length === 0
      ? '无'
      : entries.map(([key, entry]) => `${key}=${String(entry)}`).join(' · ');
  }
  if (name === 'proposed-by' && typeof value === 'object' && value !== null) {
    const proposed = value as Record<string, unknown>;
    return [proposed.actor, proposed.principal].filter(Boolean).map(String).join(' · ');
  }
  if (name === 'risk-level') {
    return value === 'high'
      ? '高'
      : value === 'medium'
        ? '中'
        : value === 'low'
          ? '低'
          : String(value);
  }
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
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
 * 集合成员条目的展示文本(T40 F-02/F-03):零硬编码字段名——
 * - 有 presentation.fields 声明的成员:按声明取 identity/primary-content 或
 *   overview 标记的已填字段值(备注等不再整段倒进列表行,声明驱动,不自造过滤);
 * - 无声明成员(确认/委托等):fields 扁平值兜底(现状,零发明);
 * - 有 node 的成员以节点中文标题(properties.title)作状态词,不再直出裸 node;
 * - 两者皆缺 → properties 展平(标量 + 一层对象,如 target-action=archive)。
 */
function memberSummary(sub: SirenEntity): string {
  const parts: string[] = [];
  const declared = declaredFieldsOf(sub);
  if (declared.length > 0) {
    for (const field of declared) {
      if (
        field.overview !== true &&
        field.role !== 'identity' &&
        field.role !== 'primary-content'
      ) {
        continue;
      }
      const value = readPathValue(sub, field.path);
      if (value === undefined || value === null || value === '') continue;
      parts.push(String(value));
    }
  } else if (typeof sub.properties.fields === 'object' && sub.properties.fields !== null) {
    for (const value of Object.values(sub.properties.fields as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) parts.push(String(value));
    }
  }
  if (
    sub.properties.node !== undefined &&
    typeof sub.properties.title === 'string' &&
    sub.properties.title !== ''
  ) {
    parts.push(sub.properties.title);
  }
  if (parts.length === 0) {
    for (const [key, value] of Object.entries(sub.properties)) {
      if (key === 'rel') continue;
      flattenProperty(parts, key, value);
    }
  }
  return parts.filter((part) => part !== '').join(' · ');
}

export interface EntityViewProps {
  /** 页面请求的 rel(标题与缺省用途)。 */
  rel: string;
  scope?: string;
  entity: SirenEntity;
  /** 任一动作 exec 成功后的刷新回调(参数 = 实际提交的实例 rel)。 */
  onChanged?: (rel: string) => void;
}

export function EntityView({ rel, scope, entity, onChanged }: EntityViewProps) {
  // T40 F-02:h1 先回答"是什么"——实例身份(identity)优先,回退节点标题/rel。
  const heading =
    typeof entity.properties.identity === 'string' && entity.properties.identity !== ''
      ? entity.properties.identity
      : typeof entity.properties.title === 'string' && entity.properties.title !== ''
        ? entity.properties.title
        : rel;
  const members = entity.entities ?? [];
  const nodePresent = entity.properties.node !== undefined;
  const nodeTitle =
    typeof entity.properties.title === 'string' && entity.properties.title !== ''
      ? entity.properties.title
      : undefined;
  const fieldRows = declaredFieldRows(entity);
  const submit = createDirectActionSubmit((input) => execAction({ ...input, scope }), {
    clientParams: ({ action }) => observedActionClientParams(action, entity.properties),
  });

  return (
    <div>
      <nav className="mb-2 text-sm">
        <a href="/" data-nav="home" className="text-primary hover:underline">
          ← 首页
        </a>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{rel}</p>
      <RawContractDrawer entity={entity} />

      <section aria-label="属性" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">属性</h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableBody>
              {Object.entries(entity.properties)
                // title 是节点标题的纯展示投影,h1 已呈现、不再上表;
                // presentation 是呈现层结构元数据,上属性表即 F-14 的 JSON
                // 原文泄漏——审计走 RawContractDrawer;
                // fields 由声明字段区呈现(下段);T40 F-02:有 node 的实体
                // 过滤裸 node 行(机器 id 退守 raw 层)。
                .filter(([key]) => {
                  if (['fields', 'title', 'presentation'].includes(key)) return false;
                  if (nodePresent && key === 'node') return false;
                  return true;
                })
                .map(([key, value]) => (
                  <TableRow key={key}>
                    <th
                      scope="row"
                      className="px-3 py-2 text-left align-top font-normal whitespace-nowrap text-muted-foreground"
                    >
                      {propertyDisplayLabel(key)}
                    </th>
                    <TableCell className="px-3 py-2 break-all whitespace-normal">
                      {propertyDisplayValue(
                        key,
                        // T40 F-02:状态行值 = 节点中文标题(与列表同源),机器枚举退守。
                        key === 'status' && nodePresent && nodeTitle !== undefined
                          ? nodeTitle
                          : value,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              {fieldRows.map(({ label, value }) => (
                <TableRow key={label}>
                  <th
                    scope="row"
                    className="px-3 py-2 text-left align-top font-normal whitespace-nowrap text-muted-foreground"
                  >
                    {label}
                  </th>
                  <TableCell className="px-3 py-2 break-all whitespace-normal">
                    {propertyDisplayValue(label, value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {entity.actions.length > 0 && (
        <section aria-label="动作" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">动作</h2>
          <ActionGroup entity={entity} rel={rel} submit={submit} onExecuted={onChanged} />
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
                    {target !== null ? (
                      <a
                        href={entityPageHref(target, scope)}
                        data-rel={target}
                        data-nav={link.rel[0]}
                        className="break-all text-primary hover:underline"
                      >
                        {link.title ?? target}
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
                      href={entityPageHref(target, scope)}
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
