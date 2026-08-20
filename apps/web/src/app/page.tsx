'use client';
/**
 * 入口页(首页,T2 Phase F):renderer 的导航入口,纯合同驱动。
 *
 * - 文章列表:GET /api/entity?rel=articles,成员(post:<id>)逐篇链接到实体页;
 * - 发布向导入口:取 articles.links 的 flow 入口链接(零 startRel 特权,从集合
 *   沿 links 到达向导——处境披露的根基);
 * - 评论队列:pending 计数 + 入口链接;
 * - 铁律 3:首页零可提交元素(无 button/form),一切动作发生在实体页的已声明
 *   action 上;悬浮聊天在全局布局,是 agent 路径入口。
 */
import type { SirenEntity } from '@ui4a/engine';
import { APP_NAME, VERSION } from '@ui4a/shared';
import { useEffect, useState } from 'react';

import { entityPageHref } from '@/components/entity-view';
import { fetchEntity } from '@/components/exec-client';

/** 成员条目文本:全部字段值 + 节点(properties.fields 为扁平 { name: value })。 */
function memberText(sub: SirenEntity): string {
  const parts: string[] = [];
  if (typeof sub.properties.fields === 'object' && sub.properties.fields !== null) {
    for (const value of Object.values(sub.properties.fields as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) parts.push(String(value));
    }
  }
  if (sub.properties.node !== undefined) parts.push(String(sub.properties.node));
  return parts.filter((part) => part !== '').join(' · ');
}

/** 从合同 href 提取 rel(/api/entity?rel=…)。 */
function hrefToRel(href: string): string | null {
  const query = href.split('?')[1] ?? '';
  const match = /(?:^|&)rel=([^&]*)/.exec(query);
  return match === null ? null : decodeURIComponent(match[1].replace(/\+/g, ' '));
}

export default function Home() {
  const [articles, setArticles] = useState<SirenEntity | null>(null);
  const [comments, setComments] = useState<SirenEntity | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nextArticles, nextComments] = await Promise.all([
          fetchEntity('articles'),
          fetchEntity('comments'),
        ]);
        if (cancelled) return;
        setArticles(nextArticles);
        setComments(nextComments);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const articleMembers = articles?.entities ?? [];
  const commentMembers = comments?.entities ?? [];
  const pendingCount = commentMembers.filter((sub) => sub.properties.node === 'pending').length;
  const wizardEntries = (articles?.links ?? [])
    .filter((link) => link.rel.includes('flow'))
    .map((link) => hrefToRel(link.href))
    .filter((rel): rel is string => rel !== null);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900">{APP_NAME}</h1>
      <p className="mt-1 text-xs text-zinc-500">v{VERSION} — 界面作为合同(人类路径 renderer)</p>

      {failed && <p className="mt-6 text-sm text-red-600">读取合同失败(服务不可用)。</p>}
      {!failed && articles === null && <p className="mt-6 text-sm text-zinc-500">加载中…</p>}

      {articles !== null && (
        <section aria-label="文章" className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">
            文章(共 {String(articles.properties.count ?? articleMembers.length)} 篇)
          </h2>
          <ul className="space-y-1 text-sm">
            {articleMembers.map((sub) => {
              const rel = hrefToRel(sub.href ?? '') ?? String(sub.properties.rel ?? '');
              return (
                <li key={rel}>
                  <a
                    href={entityPageHref(rel)}
                    data-rel={rel}
                    className="text-blue-600 hover:underline"
                  >
                    {memberText(sub)}
                  </a>
                </li>
              );
            })}
          </ul>
          {wizardEntries.map((rel) => (
            <p key={rel} className="mt-3 text-sm">
              <a
                href={entityPageHref(rel)}
                data-rel={rel}
                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-100"
              >
                + 发布向导入口({rel})
              </a>
            </p>
          ))}
        </section>
      )}

      <section aria-label="评论队列" className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">评论审核</h2>
        <p className="text-sm">
          <a
            href={entityPageHref('comments')}
            data-rel="comments"
            className="text-blue-600 hover:underline"
          >
            评论队列(待处理 {pendingCount})
          </a>
        </p>
      </section>
    </main>
  );
}
