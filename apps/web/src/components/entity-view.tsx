'use client';
/**
 * EntityView:Siren 实体四件组装的通用渲染(properties / actions / links / guard-results,
 * 集合另渲染 entities[] 子实体)。:form runner 的零智能路径(arch-brief §7)——
 *
 * - 渲染的一切动作与链接都来自实体投影,本组件不含任何业务分支;
 * - renderer 的 navigate = 把合同 href(/api/entity?rel=…)换算成页面路由 /entity?rel=…;
 * - 谓词投影:guard-results.blocked → 对应动作 disabled + title 原因;
 * - exec 提交 rel 取实体自身 properties.rel(flow: 别名页落在实例 rel 上,直投不绕别名)。
 */
import type { SirenEntity } from '@ui4a/engine';

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
 */
function fieldsSummary(fields: unknown): string {
  if (typeof fields !== 'object' || fields === null) return '';
  return Object.entries(fields as Record<string, unknown>)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(' · ');
}

/** 集合成员条目的展示文本:rel + 全部字段值 + 节点(零硬编码字段名)。 */
function memberSummary(sub: SirenEntity): string {
  const parts: string[] = [];
  if (typeof sub.properties.fields === 'object' && sub.properties.fields !== null) {
    for (const value of Object.values(sub.properties.fields as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) parts.push(String(value));
    }
  }
  if (sub.properties.node !== undefined) parts.push(String(sub.properties.node));
  return parts.filter((part) => part !== '').join(' · ');
}

export interface EntityViewProps {
  /** 页面请求的 rel(标题与缺省用途)。 */
  rel: string;
  entity: SirenEntity;
  /** 任一动作 exec 成功后的刷新回调(重新拉取实体)。 */
  onChanged?: () => void;
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

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <nav className="mb-2 text-sm">
        <a href="/" className="text-blue-600 hover:underline">
          ← 首页
        </a>
      </nav>
      <h1 className="text-2xl font-semibold text-zinc-900">{heading}</h1>
      <p className="mt-1 text-xs text-zinc-500">
        {rel}
        {entity.properties.node !== undefined ? ` · 节点 ${String(entity.properties.node)}` : ''}
      </p>

      <section aria-label="属性" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">属性</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {Object.entries(entity.properties)
              .filter(([key]) => key !== 'fields')
              .map(([key, value]) => (
                <tr key={key} className="border-b border-zinc-100">
                  <th scope="row" className="py-1 pr-4 text-left font-normal text-zinc-500">
                    {key}
                  </th>
                  <td className="py-1 text-zinc-800">{String(value)}</td>
                </tr>
              ))}
            {fieldsSummary(entity.properties.fields) !== '' && (
              <tr className="border-b border-zinc-100">
                <th scope="row" className="py-1 pr-4 text-left font-normal text-zinc-500">
                  fields
                </th>
                <td className="py-1 text-zinc-800">{fieldsSummary(entity.properties.fields)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {entity.actions.length > 0 && (
        <section aria-label="动作" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">动作</h2>
          <div className="space-y-4">
            {entity.actions.map((action) => {
              const guard = guardMap.get(action.name);
              return (
                <ActionRunner
                  // key 含参数 schema:向导跨节点同名动作(如 next)的 schema 不同,
                  // 换 key 强制换表单实例——RJSF 内部 formData 是组件态,实例被
                  // React 复用会把前节点字段漏进本节点提交(additionalProperties:
                  // false 拒绝)。每个 action schema 一个干净表单。
                  key={`${execRel}:${action.name}:${JSON.stringify(action.fields)}`}
                  rel={execRel}
                  action={action}
                  blocked={guard?.blocked}
                  blockReason={guard?.reason}
                  onExecuted={onChanged}
                />
              );
            })}
          </div>
        </section>
      )}

      {entity.links.length > 0 && (
        <section aria-label="链接" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">链接</h2>
          <ul className="space-y-1 text-sm">
            {entity.links.map((link) => {
              const target = hrefToRel(link.href);
              return (
                <li key={`${link.rel.join('/')}:${link.href}`}>
                  <span className="mr-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {link.rel.join('/')}
                  </span>
                  {target !== null ? (
                    <a
                      href={entityPageHref(target)}
                      data-rel={target}
                      className="text-blue-600 hover:underline"
                    >
                      {target}
                    </a>
                  ) : (
                    <a href={link.href} className="text-blue-600 hover:underline">
                      {link.href}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {members.length > 0 && (
        <section aria-label="成员" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">成员({members.length})</h2>
          <ul className="space-y-1 text-sm">
            {members.map((sub) => {
              const target = hrefToRel(sub.href ?? '') ?? String(sub.properties.rel ?? '');
              return (
                <li key={target}>
                  <a
                    href={entityPageHref(target)}
                    data-rel={target}
                    className="text-blue-600 hover:underline"
                  >
                    {memberSummary(sub)}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
