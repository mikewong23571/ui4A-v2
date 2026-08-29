'use client';
/**
 * collection-filters 词条(T38 FR3/FR5):仅声明维度(properties.presentation.
 * filters,定义平面数据经投影携带)渲染过滤控件——维度标题与值域标签全部来自
 * 声明数据,零 per-app 文案;当前过滤状态取自合同 self 链接(刷新/回放如实
 * 回显);值变更 → 导航到带参画布查询(翻页复位,scope/thread 保留);清除
 * (「全部」)→ 过滤参数移除,URL 同步清空,回全量读。未声明维度 → 隐藏节段,
 * 零零件。过滤是读面导航机械:永不 exec、零业务事件。
 *
 * 导航面(T38 Phase C 修复 2):宿主注入读面导航 → 就地合并读面参数(保留
 * 当前画布 subject 状态,组合面语境不 focus 落点);宿主未注入(纯词条用法)
 * 回退 focus 落点(既有行为)。
 */
import {
  canvasCollectionQueryHref,
  collectionQueryFromContractHref,
  collectionQueryNavigation,
} from '../canvas/collection-query';
import { useHostCollectionReadNavigation } from '../canvas/collection-read-navigation';

import { asOptionalFilterDeclarations, asOptionalLinks, type WordProps } from './shared';

/** 清除过滤的机制选项(通用词汇,与声明值域并列为空值)。 */
const CLEAR_ALL_VALUE = '';
const CLEAR_ALL_LABEL = '全部';

export function CollectionFiltersWord(props: WordProps) {
  const declarations = asOptionalFilterDeclarations(
    props.declarations,
    'collection-filters',
    'declarations',
  );
  const links = asOptionalLinks(props.links, 'collection-filters', 'links');
  const hostNavigate = useHostCollectionReadNavigation();
  if (declarations.length === 0) {
    return <section data-word="collection-filters" aria-label="过滤" className="hidden" />;
  }
  // 当前读面状态住合同 self 链接(投影回声,人机同门):rel = focus 落点,
  // filter.* = 现值;offset 不进控件导航(过滤即一次收窄的读,从首页起)。
  const self = links.find((link) => link.rel.includes('self'));
  const current = self === undefined ? undefined : collectionQueryFromContractHref(self.href);
  const navigateWithFilter = (dimension: string, value: string): void => {
    if (current === undefined) return;
    const filter = current.query.filter.filter((pair) => pair.dimension !== dimension);
    if (value !== CLEAR_ALL_VALUE) filter.push({ dimension, value });
    if (hostNavigate !== undefined) {
      hostNavigate({ offset: null, filter });
      return;
    }
    collectionQueryNavigation.assign(
      canvasCollectionQueryHref(window.location.href, {
        rel: current.rel,
        offset: null,
        filter,
      }),
    );
  };
  return (
    <section
      data-word="collection-filters"
      aria-label="过滤"
      className="flex flex-wrap items-center gap-x-4 gap-y-1"
    >
      {declarations.map((declaration) => {
        const active = current?.query.filter.find((pair) => pair.dimension === declaration.field);
        return (
          <label
            key={declaration.field}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <span>{declaration.title}</span>
            <select
              data-filter={declaration.field}
              value={active?.value ?? CLEAR_ALL_VALUE}
              onChange={(event) => navigateWithFilter(declaration.field, event.target.value)}
              className="rounded-md border border-border bg-card px-1 py-0.5 text-xs text-foreground"
            >
              <option value={CLEAR_ALL_VALUE}>{CLEAR_ALL_LABEL}</option>
              {declaration.values.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.title}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </section>
  );
}
