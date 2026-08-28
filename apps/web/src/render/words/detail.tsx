'use client';
/**
 * detail 词条(T9 Phase D):实体详情卡(四件组装直出;shadcn 语义令牌,
 * D13 极简回退口径已随设计基座落地退出)。
 *
 * - entity = 实体引用的解引用结果:properties(rel/node + 扁平 fields)、
 *   actions(共享 ActionGroup/ActionRunner,data-action 标注)、links(合同 href → 页面路由);
 * - 与 entity-view 复用同一 contract-driven 动作组,不经页面或实体类型组装。
 */
import { entityPageHref } from '../../components/entity-view';
import { hrefToRel } from '../../components/contract-href';
import { ActionGroup } from '../../components/actions/action-group';
import { Badge } from '@/components/ui/badge';

import { asEntity, type WordProps } from './shared';

export function DetailWord(props: WordProps) {
  const entity = asEntity(props.entity, 'detail', 'entity');
  const mode = props.mode ?? 'full';
  if (mode !== 'full' && mode !== 'actions' && mode !== 'links') {
    throw new Error(`detail 的 mode 必须是 full/actions/links,得到 ${String(mode)}`);
  }
  const heading =
    typeof entity.properties.title === 'string' && entity.properties.title !== ''
      ? entity.properties.title
      : String(entity.properties.rel ?? '实体');
  const execRel = typeof entity.properties.rel === 'string' ? entity.properties.rel : '';
  const fields =
    typeof entity.properties.fields === 'object' && entity.properties.fields !== null
      ? (entity.properties.fields as Record<string, unknown>)
      : {};
  const scalarProperties = Object.entries(entity.properties).filter(([key]) => key !== 'fields');

  // T35 F-06/R3:links 模式是关系辅助信息,降级为弱化内联行,不再套整卡 article
  // 壳;self 指回实体自身,卡题已在场,属重复噪音——通通不渲染(空区块即留白)。
  if (mode === 'links') {
    const navigable = entity.links.filter((link) => !link.rel.includes('self'));
    // 词条组件类型要求返回元素:空区块以隐藏节段留白(不渲染任何可交互内容)。
    if (navigable.length === 0) {
      return <section data-word="detail" aria-label="链接" className="hidden" />;
    }
    return (
      <section data-word="detail" aria-label="链接" className="text-xs text-muted-foreground">
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {navigable.map((link) => {
            const target = hrefToRel(link.href);
            return (
              <li key={`${link.rel.join('/')}:${link.href}`} className="flex items-center gap-1.5">
                <Badge variant="secondary" className="rounded px-1 py-0 text-[10px]">
                  {link.rel.join('/')}
                </Badge>
                {target !== null ? (
                  <a
                    href={entityPageHref(target)}
                    data-nav={link.rel[0]}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {link.title ?? target}
                  </a>
                ) : (
                  <a href={link.href} className="text-muted-foreground hover:underline">
                    {link.href}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <article
      data-word="detail"
      className="w-full rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      {mode === 'full' && <h2 className="text-lg font-semibold">{heading}</h2>}
      {mode === 'full' && (
        <table className="mt-3 w-full border-collapse text-sm">
          <tbody>
            {scalarProperties.map(([key, value]) => (
              <tr key={key} className="border-b border-border">
                <th scope="row" className="py-1 pr-4 text-left font-normal text-muted-foreground">
                  {key}
                </th>
                <td className="py-1">{String(value)}</td>
              </tr>
            ))}
            {Object.keys(fields).length > 0 && (
              <tr className="border-b border-border">
                <th scope="row" className="py-1 pr-4 text-left font-normal text-muted-foreground">
                  fields
                </th>
                <td className="py-1">
                  {Object.entries(fields)
                    .map(([name, value]) => `${name}=${String(value)}`)
                    .join(' · ')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* links 模式已在函数头早退;语义模式只呈现对应交互:actions 仅动作,
          full 才附链接段(detail.test 语义模式契约)。 */}
      {entity.actions.length > 0 && execRel !== '' && (
        <section aria-label="动作" className="mt-4 space-y-4">
          <ActionGroup entity={entity} />
        </section>
      )}

      {mode === 'full' && entity.links.length > 0 && (
        <section aria-label="链接" className="mt-4">
          <ul className="space-y-1 text-sm">
            {entity.links.map((link) => {
              const target = hrefToRel(link.href);
              return (
                <li key={`${link.rel.join('/')}:${link.href}`}>
                  <Badge variant="secondary" className="mr-2 rounded-md px-1.5 py-0.5 text-[10px]">
                    {link.rel.join('/')}
                  </Badge>
                  {target !== null ? (
                    <a
                      href={entityPageHref(target)}
                      data-nav={link.rel[0]}
                      className="text-primary hover:underline"
                    >
                      {link.title ?? target}
                    </a>
                  ) : (
                    <a href={link.href} className="text-primary hover:underline">
                      {link.href}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
