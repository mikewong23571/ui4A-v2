'use client';
/**
 * detail 词条(T9 Phase D):实体详情卡(四件组装直出;shadcn 语义令牌,
 * D13 极简回退口径已随设计基座落地退出)。
 *
 * - entity = 实体引用的解引用结果:properties(rel/node + 扁平 fields)、
 *   actions(ActionRunner,data-action 标注)、links(合同 href → 页面路由);
 * - 与 entity-view 同口径但独立成词条(词汇表消费,不经页面组装)。
 */
import { entityPageHref } from '../../components/entity-view';
import { ActionRunner } from '../../components/action-runner';
import { blockedForRenderer } from '../../components/entity-view';
import { Badge } from '@/components/ui/badge';

import { asEntity, type WordProps } from './shared';

/** 从合同 href 提取 rel(只认 /api/entity?rel=…;与 entity-view 同口径)。 */
function hrefToRel(href: string): string | null {
  const query = href.split('?')[1] ?? '';
  const match = /(?:^|&)rel=([^&]*)/.exec(query);
  return match === null ? null : decodeURIComponent(match[1].replace(/\+/g, ' '));
}

export function DetailWord(props: WordProps) {
  const entity = asEntity(props.entity, 'detail', 'entity');
  const heading =
    typeof entity.properties.title === 'string' && entity.properties.title !== ''
      ? entity.properties.title
      : String(entity.properties.rel ?? '实体');
  const guardMap = new Map((entity['guard-results'] ?? []).map((entry) => [entry.action, entry]));
  const execRel = typeof entity.properties.rel === 'string' ? entity.properties.rel : '';
  const fields =
    typeof entity.properties.fields === 'object' && entity.properties.fields !== null
      ? (entity.properties.fields as Record<string, unknown>)
      : {};
  const scalarProperties = Object.entries(entity.properties).filter(([key]) => key !== 'fields');

  return (
    <article
      data-word="detail"
      className="w-full rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm"
    >
      <h2 className="text-lg font-semibold">{heading}</h2>
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

      {entity.actions.length > 0 && execRel !== '' && (
        <section aria-label="动作" className="mt-4 space-y-4">
          {entity.actions.map((action) => {
            const guard = guardMap.get(action.name);
            return (
              <ActionRunner
                key={`${execRel}:${action.name}:${JSON.stringify(action.fields)}`}
                rel={execRel}
                action={action}
                blocked={blockedForRenderer(guard)}
                blockReason={guard?.reason}
              />
            );
          })}
        </section>
      )}

      {entity.links.length > 0 && (
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
                      {target}
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
