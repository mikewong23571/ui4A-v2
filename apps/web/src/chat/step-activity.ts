/**
 * step 帧活动数据的服务端投影(T24 Phase B Task 2):TrailStep + 合同
 * sitemap → SSE step 帧的 {op, title?, subject?} 结构化显示数据。
 *
 * 这是呈现接线层:不改 trail.ts 机器文本(message.text 原文随帧保留作机器层),
 * 不改引擎/事件语义;标题一律来自合同(sitemap surfaces 的表面标题、flows
 * 的动作标题),拿不到就退合同标识(rel/动作名),零发明标题。
 *
 * - op:AgentOperation kind 原样(navigate/answer/clarify/present/exec/
 *   exec-plan/done/fail),客户端按固定 op 词表渲染活动语言;
 * - navigate 标题:surfaces 表面标题 → flow 实体(class 第二项)的流程标题
 *   → rel 兜底;
 * - exec 标题:TrailStep.entity 是动作后实体(节点已迁移),按「迁移进入的
 *   节点」反查流程边(from 节点的动作标题);无边可依时,若同名动作在该流程
 *   内标题唯一则用之,否则退动作名;
 * - present subject:字符串原样,selection 以「、」联结;
 * - answer/clarify/exec-plan/done/fail:仅 op(终局内容经 final.summary 呈现)。
 */
import {
  createContractClient,
  type FetchLike,
  type SitemapSummary,
  type TrailStep,
} from '@ui4a/agent';

import type { ChatStepActivity } from './sse';

/** sitemap 中活动标题所需的合同投影(读端按形状窄化,缺字段如实降级)。 */
export interface SitemapTitles {
  /** rel → 表面标题(集合/flow 定义实体)。 */
  surfaces: Map<string, string>;
  flows: {
    name: string;
    title?: string;
    /** 节点名 → (动作名 → 动作标题)。 */
    nodes: Map<string, Map<string, string>>;
    edges: { from: string; action: string; to: string }[];
  }[];
}

/** 已解析 sitemap 摘要 → 活动标题索引；纯机械投影，零 I/O。 */
export function sitemapTitlesFromSummary(
  sitemap: SitemapSummary | undefined,
): SitemapTitles | undefined {
  if (sitemap === undefined) return undefined;
  const surfaces = new Map(sitemap.surfaces.map((surface) => [surface.rel, surface.title]));
  const flows = (sitemap.flows ?? []).map((flow) => {
    const nodes = new Map<string, Map<string, string>>();
    for (const action of flow.actions ?? []) {
      const actions = nodes.get(action.node) ?? new Map<string, string>();
      actions.set(action.name, action.title);
      nodes.set(action.node, actions);
    }
    return {
      name: flow.name,
      title: flow.title,
      nodes,
      edges: (flow.edges ?? []).map((edge) => ({ ...edge })),
    };
  });
  return { surfaces, flows };
}

/**
 * 读合同 sitemap 并投影为标题索引;不可得(端点缺失/非 200/形状异常)时返回
 * undefined——活动数据退 rel/动作名,呈现照常(机械层兜底,不阻断聊天)。
 */
export async function readSitemapTitles(
  baseUrl: string,
  fetchImpl: FetchLike,
): Promise<SitemapTitles | undefined> {
  const sitemap = await createContractClient(baseUrl, fetchImpl).getSitemap();
  return sitemapTitlesFromSummary(sitemap);
}

/** flow 实体的 Siren class 形如 ['flow-instance', <flow 名>];其余实体无流程可依。 */
function flowNameOfEntity(step: TrailStep): string | undefined {
  const classes = step.entity?.class ?? [];
  return classes[0] === 'flow-instance' && typeof classes[1] === 'string' ? classes[1] : undefined;
}

function navigateTitle(step: TrailStep, titles: SitemapTitles | undefined): string {
  if (step.op.kind !== 'navigate') return step.rel;
  const fromSurface = titles?.surfaces.get(step.op.rel);
  if (fromSurface !== undefined) return fromSurface;
  const flowName = flowNameOfEntity(step);
  const flowTitle =
    flowName !== undefined
      ? titles?.flows.find((flow) => flow.name === flowName)?.title
      : undefined;
  return flowTitle ?? step.op.rel;
}

function execTitle(step: TrailStep, titles: SitemapTitles | undefined): string {
  if (step.op.kind !== 'exec') return step.op.kind;
  const action = step.op.action;
  const flowName = flowNameOfEntity(step);
  const flow =
    flowName !== undefined
      ? titles?.flows.find((candidate) => candidate.name === flowName)
      : undefined;
  if (flow === undefined) return action;
  const node = step.entity?.node;
  if (node !== undefined) {
    // entity 是动作后实体:动作迁移「进入」当前节点,反查边的 from 节点取标题。
    const edge = flow.edges.find(
      (candidate) => candidate.action === action && candidate.to === node,
    );
    if (edge !== undefined) {
      const title = flow.nodes.get(edge.from)?.get(action);
      if (title !== undefined) return title;
    }
  }
  // 无边可依(终态动作/无节点信息):同名动作在该流程内标题唯一时用之。
  const titlesForAction = [
    ...new Set(
      [...flow.nodes.values()]
        .map((actions) => actions.get(action))
        .filter((t): t is string => t !== undefined),
    ),
  ];
  return titlesForAction.length === 1 ? titlesForAction[0]! : action;
}

function presentSubject(step: TrailStep): string {
  if (step.op.kind !== 'present') return '';
  const subject = step.op.subject;
  return typeof subject === 'string' ? subject : subject.selection.join('、');
}

/** 轨迹一步 → step 帧结构化活动数据(纯函数;渲染词表在客户端,本层零文案)。 */
export function stepActivityData(
  step: TrailStep,
  titles: SitemapTitles | undefined,
): ChatStepActivity {
  const op = step.op.kind;
  switch (op) {
    case 'navigate':
      return { op, title: navigateTitle(step, titles) };
    case 'exec':
      return { op, title: execTitle(step, titles) };
    case 'present':
      return { op, subject: presentSubject(step) };
    default:
      return { op };
  }
}
