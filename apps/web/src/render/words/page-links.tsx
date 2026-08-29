'use client';
/**
 * page-links 词条(T38 FR2/FR5):集合分页脚——只渲染合同声明的 next/prev
 * 页链接(「上一页/下一页」式):零页码推算、零页尺寸常量、零页码列表
 * (传统分页组件按 §六 判据退回);点击 = 导航到声明链接对应的带参画布查询
 * (URL query 同步,scope/thread 保留)。无声明链接 → 隐藏节段,零零件。
 *
 * 过滤/翻页是读面导航机械:只改查询状态,永不 exec、零业务事件;参数语义与
 * /api/entity 请求同形(人机同门,agent 走同一 next/prev 链接)。
 */
import {
  canvasCollectionQueryHref,
  collectionQueryFromContractHref,
  collectionQueryNavigation,
} from '../../components/canvas/collection-query';

import { asOptionalLinks, type WordProps } from './shared';

function navigateToDeclaredPage(href: string): void {
  const target = collectionQueryFromContractHref(href);
  // 无 rel 可导航的声明链接诚实不动(不发明任何推算)。
  if (target === undefined) return;
  collectionQueryNavigation.assign(
    canvasCollectionQueryHref(window.location.href, {
      rel: target.rel,
      offset: target.query.offset,
      filter: target.query.filter,
    }),
  );
}

const controlClassName =
  'rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50';

export function PageLinksWord(props: WordProps) {
  const links = asOptionalLinks(props.links, 'page-links', 'links');
  const prev = links.find((link) => link.rel.includes('prev'));
  const next = links.find((link) => link.rel.includes('next'));
  if (prev === undefined && next === undefined) {
    return <section data-word="page-links" aria-label="分页" className="hidden" />;
  }
  return (
    <nav data-word="page-links" aria-label="分页" className="flex items-center gap-2">
      {prev !== undefined && (
        <button
          type="button"
          data-nav="collection:prev"
          onClick={() => navigateToDeclaredPage(prev.href)}
          className={controlClassName}
        >
          上一页
        </button>
      )}
      {next !== undefined && (
        <button
          type="button"
          data-nav="collection:next"
          onClick={() => navigateToDeclaredPage(next.href)}
          className={controlClassName}
        >
          下一页
        </button>
      )}
    </nav>
  );
}
