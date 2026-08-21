'use client';
/**
 * 入口页(首页,T2 Phase F;T7 Phase B 改造为态势投影 + 骨架导航)。
 *
 * - 态势投影(spec 架构决定 5,骨架路径:写死绑定,零 AI,审计通道隔离):
 *   stat 待确认(inbox.count)/ 在飞委托(delegations running 计数)/
 *   文章数(articles.count)——数值经 deref 从实体投影取回(态势数字与
 *   实体一致,组件测试对拍);timeline 最近 N 事件(/api/events 投影,
 *   原始数据零 AI 渲染);
 * - 全站导航(SiteNav):收件箱/事件流/画布/舰队/BIOS(发布向导经合同
 *   links 动态进入,零 startRel 特权);
 * - 既有走查锚点保留:文章(共 N 篇)/成员链接/flow 入口/收件箱(待确认 N)/
 *   评论队列(待处理 N)(human/s1 e2e 断言);
 * - 铁律 3:首页零可提交元素(无 form / 无可聚焦提交按钮),一切动作
 *   发生在实体页的已声明 action 上;悬浮聊天在全局布局,是 agent 路径入口。
 */
import type { SirenEntity } from '@ui4a/engine';
import { APP_NAME, VERSION } from '@ui4a/shared';
import { useEffect, useState } from 'react';

import { entityPageHref } from '@/components/entity-view';
import { fetchEntity } from '@/components/exec-client';
import { SiteNav } from '@/components/site-nav';
import { derefSpec, type EntityCache } from '@/render/deref';
import {
  eventsToMembers,
  runningDelegationsOf,
  situationStatBinds,
  type LogEventRow,
} from '@/render/situation';
import { StatWord } from '@/render/words/stat';
import { TimelineWord } from '@/render/words/timeline';

/** 态势时间线的最近事件条数(投影窗口;完整事件流在 /events)。 */
const RECENT_EVENTS = 5;

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

interface SituationState {
  cache: EntityCache;
  running: number;
  recentEvents: LogEventRow[];
}

export default function Home() {
  const [articles, setArticles] = useState<SirenEntity | null>(null);
  const [comments, setComments] = useState<SirenEntity | null>(null);
  const [inbox, setInbox] = useState<SirenEntity | null>(null);
  const [situation, setSituation] = useState<SituationState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [nextArticles, nextComments, nextInbox, delegations, eventsResponse] =
          await Promise.all([
            fetchEntity('articles'),
            fetchEntity('comments'),
            fetchEntity('inbox'),
            fetchEntity('delegations'),
            fetch('/api/events'),
          ]);
        if (cancelled) return;
        setArticles(nextArticles);
        setComments(nextComments);
        setInbox(nextInbox);
        // 态势取数:实体进缓存(stat 经 deref 取值);事件取最近 N(尾部)。
        const cache: EntityCache = new Map();
        for (const entity of [nextArticles, nextComments, nextInbox, delegations]) {
          if (entity !== null) cache.set(String(entity.properties.rel), entity);
        }
        const eventsBody = (await eventsResponse.json()) as { events?: LogEventRow[] };
        const allEvents = eventsBody.events ?? [];
        setSituation({
          cache,
          running: delegations !== null ? runningDelegationsOf(delegations) : 0,
          recentEvents: allEvents.slice(Math.max(0, allEvents.length - RECENT_EVENTS)),
        });
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
  // pending 确认计数取集合投影的 count(engine 口径),投影缺失时回退成员计数。
  const inboxPending =
    inbox !== null ? Number(inbox.properties.count ?? (inbox.entities ?? []).length) : 0;
  const wizardEntries = (articles?.links ?? [])
    .filter((link) => link.rel.includes('flow'))
    .map((link) => hrefToRel(link.href))
    .filter((rel): rel is string => rel !== null);

  // 态势 stat:骨架静态绑定(零 AI)→ deref 取值(数值来自实体投影)。
  const statBinds = situationStatBinds();
  const pendingStat =
    situation !== null ? derefSpec(statBinds.pending, situation.cache) : undefined;
  const articlesStat =
    situation !== null ? derefSpec(statBinds.articles, situation.cache) : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900">{APP_NAME}</h1>
      <p className="mt-1 text-xs text-zinc-500">v{VERSION} — 界面作为合同(人类路径 renderer)</p>
      <SiteNav />

      {failed && <p className="mt-6 text-sm text-red-600">读取合同失败(服务不可用)。</p>}
      {!failed && articles === null && <p className="mt-6 text-sm text-zinc-500">加载中…</p>}

      {/* 态势投影(骨架路径:写死绑定,零 AI;数值与实体一致) */}
      <section aria-label="态势投影" className="mt-8" data-testid="situation">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">态势</h2>
        <div className="flex flex-wrap gap-4">
          {pendingStat !== undefined && (
            <div data-testid="stat-pending">
              <StatWord value={pendingStat.value} label="待确认" />
            </div>
          )}
          <div data-testid="stat-running">
            <StatWord value={situation?.running ?? 0} label="在飞委托" />
          </div>
          {articlesStat !== undefined && (
            <div data-testid="stat-articles">
              <StatWord value={articlesStat.value} label="文章数" />
            </div>
          )}
        </div>
        {situation !== null && situation.recentEvents.length > 0 && (
          <div className="mt-4" data-testid="situation-timeline">
            <TimelineWord events={eventsToMembers(situation.recentEvents)} />
          </div>
        )}
      </section>

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
                    data-nav="item"
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
                data-nav="flow-entry"
                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-100"
              >
                + 发布向导入口({rel})
              </a>
            </p>
          ))}
        </section>
      )}

      <section aria-label="收件箱" className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">收件箱</h2>
        <p className="text-sm">
          <a
            href={entityPageHref('inbox')}
            data-rel="inbox"
            data-nav="inbox"
            className="text-blue-600 hover:underline"
          >
            收件箱(待确认 {inboxPending})
          </a>
        </p>
      </section>

      <section aria-label="评论队列" className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">评论审核</h2>
        <p className="text-sm">
          <a
            href={entityPageHref('comments')}
            data-rel="comments"
            data-nav="comments"
            className="text-blue-600 hover:underline"
          >
            评论队列(待处理 {pendingCount})
          </a>
        </p>
      </section>

      {/* 委托舰队入口(T5 Phase B):并行委托的监控视图;纯导航链接,零可提交元素。 */}
      <section aria-label="委托舰队" className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">委托舰队</h2>
        <p className="text-sm">
          <a
            href="/delegations"
            data-rel="delegations"
            data-nav="delegations"
            className="text-blue-600 hover:underline"
          >
            委托舰队(并行委托监控)
          </a>
        </p>
      </section>

      {/* BIOS 入口(T4 Phase C):仅一行链接——进入定义层必须显式意图,
          业务站 sitemap 不携带 _meta(跨站规则)。 */}
      <section aria-label="BIOS" className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">BIOS</h2>
        <p className="text-sm">
          <a href="/meta" data-rel="meta" data-nav="meta" className="text-blue-600 hover:underline">
            BIOS · 定义平面(定义查看 / 激活队列审批)
          </a>
        </p>
      </section>
    </main>
  );
}
