'use client';
/**
 * F-27② 对象选择器:「＋添加涉及对象」的候选面板。
 *
 * - 候选 = sitemap 集合面(collection:true)成员——§二 同一扇门:人与 agent
 *   共用的发现面,机械派生零特判;flow 面不是集合,不入候选;
 * - 集合实体读取走页面级缓存(useEntityCache);顶部标题过滤;点击即挂由
 *   宿主执行(attach category 缺省 context);已在本线的成员禁选并标注;
 * - 零每实体特判:身份/状态一律读实体声明字段。
 */
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';

import { useEntityCache } from '../entity-cache-provider';
import { withPolicyScope } from '../exec-client';
import { hrefToRel } from '../contract-href';
import { firstString } from './thread-desk-shared';

interface SelectorMember {
  rel: string;
  identity: string;
  status?: string;
}

interface SelectorGroup {
  collection: string;
  title: string;
  members: SelectorMember[];
}

export function ObjectSelectorPanel({
  attachedRels,
  busy,
  onPick,
  onClose,
}: {
  attachedRels: ReadonlySet<string>;
  busy: boolean;
  onPick: (rel: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const cache = useEntityCache();
  const [groups, setGroups] = useState<SelectorGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('');

  // load 不在体内同步 setState(failed 归零由重试按钮处理器负责;挂载时
  // failed 本就为 false)——react-hooks/set-state-in-effect 合规。
  const load = useCallback(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(withPolicyScope('/.well-known/ui4a.json', undefined));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as {
          surfaces?: Array<{ rel?: unknown; title?: unknown; collection?: unknown }>;
        };
        const collections = (body.surfaces ?? []).filter(
          (surface): surface is { rel: string; title?: string } =>
            surface.collection === true && typeof surface.rel === 'string',
        );
        const loaded: SelectorGroup[] = [];
        for (const collection of collections) {
          const entity = await cache.get(collection.rel).catch(() => null);
          if (cancelled) return;
          const members = (entity?.entities ?? [])
            .map((member): SelectorMember | null => {
              const rel =
                firstString(member.properties.rel) ??
                member.links
                  .map((link) => hrefToRel(link.href))
                  .find((rel): rel is string => rel !== null) ??
                null;
              if (rel === null || rel === '') return null;
              return {
                rel,
                identity: firstString(member.properties.identity, member.properties.title) ?? rel,
                status: firstString(member.properties.title, member.properties.statusText),
              };
            })
            .filter((member): member is SelectorMember => member !== null);
          loaded.push({
            collection: collection.rel,
            title: firstString(entity?.properties.title) ?? collection.title ?? collection.rel,
            members,
          });
        }
        if (!cancelled) setGroups(loaded);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cache]);

  useEffect(() => load(), [load]);

  const needle = filter.trim().toLowerCase();
  const visible = (groups ?? [])
    .map((group) => ({
      ...group,
      members: group.members.filter(
        (member) =>
          needle === '' ||
          member.identity.toLowerCase().includes(needle) ||
          member.rel.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.members.length > 0);

  return (
    <div
      data-testid="desk-selector"
      className="mt-2 rounded-md border bg-background p-2"
      role="group"
      aria-label="选择涉及对象"
    >
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="按标题过滤"
          aria-label="按标题过滤"
          data-testid="desk-selector-filter"
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          收起
        </button>
      </div>
      {groups === null && !failed && (
        <p className="mt-2 text-xs text-muted-foreground">正在列出可选对象…</p>
      )}
      {failed && (
        <p className="mt-2 text-xs text-muted-foreground">
          对象清单暂时读不到，
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              load();
            }}
            className="underline hover:text-foreground"
          >
            重试
          </button>
          。
        </p>
      )}
      {groups !== null && visible.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">没有匹配的对象。</p>
      )}
      <div className="mt-1 max-h-64 overflow-y-auto">
        {visible.map((group) => (
          <div key={group.collection} className="mt-1">
            <p className="px-1 py-0.5 text-[11px] text-muted-foreground">
              {group.title}（{group.members.length}）
            </p>
            <ul>
              {group.members.map((member) => {
                const attached = attachedRels.has(member.rel);
                return (
                  <li key={member.rel}>
                    <button
                      type="button"
                      data-testid={`desk-selector-pick:${member.rel}`}
                      disabled={busy || attached}
                      onClick={() => void onPick(member.rel)}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs hover:bg-accent disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate">{member.identity}</span>
                      {attached ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 rounded px-1 py-0 text-[10px] font-normal"
                        >
                          已在本线
                        </Badge>
                      ) : (
                        member.status !== undefined && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {member.status}
                          </span>
                        )
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
