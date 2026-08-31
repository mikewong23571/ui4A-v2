import type { Sitemap } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

import { reachableForGranted } from '../auth/application-scope';
import type { Situation } from '../engine/situation';
import type { ChatStartNotice } from './sse';

type Applications = NonNullable<EngineSnapshot['applications']>;

/**
 * 业务面"真实业务 rel"存在性表(T40 B1):快照实体表 ∪ sitemap 表面 ∪
 * application 入口目标——与 business `project()` 读面全集一致(含 flow:<name>
 * 入口别名与 T35 F-23 空集合面)。`workspace:*` 虚主体、未知 rel 天然缺席:
 * 虚主体只在 Presentation 组合面存在,业务合同面结构性不可达(virtual-subjects
 * 不变量),不存在性表是它最简的机械判据。
 */
export function knownBusinessRels(snapshot: EngineSnapshot, sitemap: Sitemap): ReadonlySet<string> {
  const rels = new Set<string>(['applications']);
  for (const rel of Object.keys(snapshot.instances)) rels.add(rel);
  for (const rel of Object.keys(snapshot.collections)) rels.add(rel);
  for (const id of Object.keys(snapshot.threads ?? {})) rels.add(`thread:${id}`);
  for (const rel of Object.keys(snapshot.confirmations ?? {})) rels.add(rel);
  for (const rel of Object.keys(snapshot.delegations ?? {})) rels.add(rel);
  for (const rel of Object.keys(snapshot.artifacts ?? {})) rels.add(rel);
  for (const concern of Object.keys(snapshot.renderSpecs ?? {})) rels.add(`render-spec:${concern}`);
  for (const surface of sitemap.surfaces) rels.add(surface.rel);
  for (const application of Object.values(snapshot.applications ?? {})) {
    if (application.entry !== undefined) rels.add(application.entry.target);
  }
  return rels;
}

/** An application entry is optional; the neutral discovery root never invents a selection. */
function siteFallbackRel(situation: Situation, applications: Applications): string {
  if (situation.site === 'meta') return 'meta/applications';
  const entry = situation.scope === undefined ? undefined : applications[situation.scope]?.entry;
  if (entry !== undefined) return entry.target;
  return 'applications';
}

/**
 * chat 起步 rel 解析(T40 B1,替代 startRelFromSituation 的无条件信任):
 * - focus 仅当其指向业务面真实实体(存在性表命中)且授权内(credential 模式
 *   按 D51 受众谓词——与 /api/entity 咽喉同谓词;local 模式受众谓词不适用)
 *   时才作为起步 rel 保留;
 * - `workspace:app:*` 虚主体、不存在、授权外 focus 一律回落 scope entry,再
 *   回落站点兜底;起步永不因 focus 失效而阻断;
 * - 降级产出结构化 notice(机械 code + 原/新 rel + 合同 sitemap 标题),随
 *   final 帧下发,机械 code 在客户端退守折叠层;
 * - meta 站:站内 focus 是规范 meta rel(跨站规则下业务存在性表不含 meta rel),
 *   原样起步;失效由 /_meta 合同自身裁决,不重复判定。
 * 纯函数,零 I/O、零可达性预探测(探活交给循环内的合同 GET)。
 */
export function resolveStartRel(args: {
  situation: Situation;
  snapshot: EngineSnapshot;
  sitemap: Sitemap;
  /** 凭证授予的应用集合;null = local 模式(受众谓词不适用)。 */
  granted: readonly string[] | null;
}): { rel: string; notice?: ChatStartNotice } {
  const { situation, snapshot, sitemap, granted } = args;
  const applications = snapshot.applications ?? {};
  if (situation.site === 'meta') {
    return {
      rel:
        typeof situation.focus === 'string'
          ? situation.focus
          : siteFallbackRel(situation, applications),
    };
  }
  const threadId = situation.thread?.replace(/^thread:/, '');
  const thread = threadId === undefined ? undefined : snapshot.threads?.[threadId];
  const fallback =
    thread !== undefined && thread.owner === situation.principal
      ? `thread:${thread.id}`
      : siteFallbackRel(situation, applications);
  if (typeof situation.focus !== 'string') return { rel: fallback };
  const focus = situation.focus;
  const known = knownBusinessRels(snapshot, sitemap);
  if (
    known.has(focus) &&
    (granted === null ||
      reachableForGranted({ snapshot, sitemap, plane: 'business' }, focus, granted))
  ) {
    return { rel: focus };
  }
  const notice: ChatStartNotice = {
    code: 'focus_degraded',
    droppedRel: focus,
    startedRel: fallback,
  };
  const title = sitemap.surfaces.find((surface) => surface.rel === fallback)?.title;
  if (title !== undefined) notice.startedTitle = title;
  return { rel: fallback, notice };
}
