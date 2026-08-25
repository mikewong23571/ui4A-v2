'use client';
/**
 * 首页主体(T2 Phase F;T7 Phase B 改造为态势投影 + 骨架导航;T12 Phase B
 * Task 3 接入页面级实体缓存)。
 *
 * 与 app/page.tsx 拆分的理由同 entity 页:页面壳只挂页面级缓存承载
 * (EntityCacheProvider,生命周期 = 本页,由 e2e 走查覆盖);取数状态机与
 * 渲染在此,组件级可测。
 *
 * - 取数经 useEntityCache().get(rel + sitemap version 一致性戳):同页会话内
 *   同 rel 零重复 fetch;version 变全量失效,exec 精确失效(Task 2 口径);
 * - 态势投影(spec 架构决定 5,骨架路径:写死绑定,零 AI,审计通道隔离):
 *   stat 待确认(inbox.count)/ 执行中委托(delegations running 计数)/
 *   文章数(articles.count)——数值经 deref 从实体投影取回(态势数字与
 *   实体一致,组件测试对拍);deref 视图 = 本次取回实体的渲染期快照
 *   (现取现填,零响应式订阅);timeline 最近 N 事件(/api/events 投影,
 *   原始数据零 AI 渲染;事件非实体,不入实体缓存,每轮挂载直取);
 * - 全站导航:T9 Phase A 起由 AppShell 顶栏统一提供(各页面不再自引);
 * - 既有走查锚点保留:文章(共 N 篇)/成员链接/flow 入口/收件箱(待确认 N)/
 *   评论队列(待处理 N)(human/s1 e2e 断言);
 * - 铁律 3:首页零可提交元素(无 form / 无可聚焦提交按钮),一切动作
 *   发生在实体页的已声明 action 上;悬浮聊天在全局布局,是 agent 路径入口。
 */
import type { SirenEntity } from '@ui4a/engine';
import { APP_NAME, VERSION } from '@ui4a/shared';
import { useEffect, useState } from 'react';

import { derefSpec, type EntityCache } from '@/render/deref';
import {
  eventsToMembers,
  runningDelegationsOf,
  situationStatBinds,
  type LogEventRow,
} from '@/render/situation';
import { StatWord } from '@/render/words/stat';
import { TimelineWord } from '@/render/words/timeline';

import { redirectToLoginOnAuthError } from './auth-redirect';
import { useEntityCache } from './entity-cache-provider';
import { entityPageHref } from './entity-view';
import { buttonVariants } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

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
  entities: EntityCache;
  running: number;
  recentEvents: LogEventRow[];
}

export function HomeBody() {
  const cache = useEntityCache();
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
            cache.get('articles'),
            cache.get('comments'),
            cache.get('inbox'),
            cache.get('delegations'),
            fetch('/api/events'),
          ]);
        if (cancelled) return;
        setArticles(nextArticles);
        setComments(nextComments);
        setInbox(nextInbox);
        // 态势取数:实体经页面缓存取回(stat 经 deref 取值);事件取最近 N(尾部)。
        const entities: EntityCache = new Map();
        for (const entity of [nextArticles, nextComments, nextInbox, delegations]) {
          if (entity !== null) entities.set(String(entity.properties.rel), entity);
        }
        const eventsBody = eventsResponse.ok
          ? ((await eventsResponse.json()) as { events?: LogEventRow[] })
          : undefined;
        if (eventsBody === undefined) {
          // 认证类 401 统一跳转登录(不再显示"读取合同失败");其余失败走 failed 分支。
          const body = (await eventsResponse.json().catch(() => undefined)) as unknown;
          if (redirectToLoginOnAuthError(eventsResponse.status, body)) return;
          throw new Error(`GET /api/events → HTTP ${eventsResponse.status}`);
        }
        const allEvents = eventsBody.events ?? [];
        setSituation({
          entities,
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
  }, [cache]);

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
    situation !== null ? derefSpec(statBinds.pending, situation.entities) : undefined;
  const articlesStat =
    situation !== null ? derefSpec(statBinds.articles, situation.entities) : undefined;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        v{VERSION} — 界面作为合同(人类路径 renderer)
      </p>

      {failed && <p className="mt-6 text-sm text-destructive">读取合同失败(服务不可用)。</p>}
      {!failed && articles === null && (
        <p className="mt-6 text-sm text-muted-foreground">加载中…</p>
      )}

      {/* 态势投影(骨架路径:写死绑定,零 AI;数值与实体一致) */}
      <section aria-label="运行概览" className="mt-8" data-testid="situation">
        <h2 className="mb-3 text-sm font-semibold">运行概览</h2>
        <div className="flex flex-wrap gap-4">
          {pendingStat !== undefined && (
            <div data-testid="stat-pending">
              <StatWord value={pendingStat.value} label="待确认" />
            </div>
          )}
          <div data-testid="stat-running">
            <StatWord value={situation?.running ?? 0} label="执行中委托" />
            <p
              data-testid="stat-running-help"
              className="mt-1 max-w-40 text-xs text-muted-foreground"
            >
              已派发且尚未完成的委托数量
            </p>
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
          <Card className="gap-3 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm font-semibold">
                文章(共 {String(articles.properties.count ?? articleMembers.length)} 篇)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="space-y-1 text-sm">
                {articleMembers.map((sub) => {
                  const rel = hrefToRel(sub.href ?? '') ?? String(sub.properties.rel ?? '');
                  return (
                    <li key={rel}>
                      <a
                        href={entityPageHref(rel)}
                        data-rel={rel}
                        data-nav="item"
                        className="text-primary hover:underline"
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
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    + 发布向导入口({rel})
                  </a>
                </p>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <section aria-label="收件箱" className="mt-8">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-semibold">收件箱</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-sm">
            <a
              href={entityPageHref('inbox')}
              data-rel="inbox"
              data-nav="inbox"
              className="text-primary hover:underline"
            >
              收件箱(待确认 {inboxPending})
            </a>
          </CardContent>
        </Card>
      </section>

      <section aria-label="评论队列" className="mt-8">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-semibold">评论审核</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-sm">
            <a
              href={entityPageHref('comments')}
              data-rel="comments"
              data-nav="comments"
              className="text-primary hover:underline"
            >
              评论队列(待处理 {pendingCount})
            </a>
          </CardContent>
        </Card>
      </section>

      {/* 委托舰队入口(T5 Phase B):并行委托的监控视图;纯导航链接,零可提交元素。 */}
      <section aria-label="委托监控" className="mt-8">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-semibold">委托监控</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-sm">
            <a
              href="/delegations"
              data-rel="delegations"
              data-nav="delegations"
              className="text-primary hover:underline"
            >
              委托监控：查看并行委托的执行状态
            </a>
          </CardContent>
        </Card>
      </section>

      {/* BIOS 入口(T4 Phase C):仅一行链接——进入定义层必须显式意图,
          业务站 sitemap 不携带 _meta(跨站规则)。 */}
      <section aria-label="定义管理" className="mt-8">
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-semibold">定义管理</CardTitle>
          </CardHeader>
          <CardContent className="px-4 text-sm">
            <a
              href="/meta"
              data-rel="meta"
              data-nav="meta"
              className="text-primary hover:underline"
            >
              定义管理：查看流程、能力与激活审批
            </a>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
