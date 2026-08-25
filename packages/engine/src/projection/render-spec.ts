/**
 * 凝固渲染 spec(T7 / spec 架构决定 4):render-spec-frozen 事件的 fold
 * 重放与 rel 约定。放在 engine(与 confirmation/delegation 同口径):fold
 * 是"应用核心"本体,日志形状(事件 detail 载荷)是引擎公共合同的一部分。
 *
 * 语义:"凝固"= 按关注点首次生成渲染后缓存,同一关注点永远同一布局
 * (保空间记忆锚点)。web 服务层 freezeSpec 首冻追加事件、同 concern
 * 二次请求直接返回已凝固(不追加);fold 对日志中的重复冻结:同 spec
 * 幂等(双写者竞态安全),异 spec 响亮抛错(凝固语义的日志完整性守卫)。
 * bind 的零字面形状由 web 侧校验器在入口把关,引擎按"载荷即真相"折叠
 * (与 confirmation-requested 同口径,重放确定性不依赖外部校验器)。
 */
import type { EngineSnapshot, FrozenRenderSpec } from '@ui4a/shared';

import type { LogEvent } from './fold/index';

/** render-specs 集合实体 rel(concern 集合;空集合同样合法,非 404)。 */
export const RENDER_SPECS_REL = 'render-specs';

/** 已凝固渲染 spec 实体 rel:`render-spec:<concern>`。 */
export const RENDER_SPEC_REL_PREFIX = 'render-spec:';

/** 已凝固 spec 实体 rel。 */
export function renderSpecRel(concern: string): string {
  return `${RENDER_SPEC_REL_PREFIX}${concern}`;
}

/** render-spec-frozen 事件的 detail 载荷(spec 为冻结时的完整渲染说明)。 */
export interface RenderSpecFrozenDetail {
  concern: string;
  spec: { concern: string; component: string; bind: unknown };
  requestedBy: { actor: 'human' | 'agent'; principal?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 载荷形状校验(detail 完整性;不重复零字面校验——web 入口已把关)。 */
function frozenPayload(event: LogEvent): RenderSpecFrozenDetail {
  const detail = event.detail as Partial<RenderSpecFrozenDetail> | undefined;
  if (
    detail === undefined ||
    !isRecord(detail) ||
    typeof detail.concern !== 'string' ||
    detail.concern === '' ||
    !isRecord(detail.spec) ||
    typeof detail.spec.concern !== 'string' ||
    typeof detail.spec.component !== 'string' ||
    detail.spec.component === '' ||
    detail.spec.bind === undefined ||
    !isRecord(detail.requestedBy) ||
    (detail.requestedBy.actor !== 'human' && detail.requestedBy.actor !== 'agent')
  ) {
    throw new Error(
      `重放失败:seq=${event.seq} render-spec-frozen 缺少 detail 载荷(concern/spec{concern,component,bind}/requestedBy;日志完整性)`,
    );
  }
  return detail as RenderSpecFrozenDetail;
}

/**
 * render-spec-frozen 重放:物化 renderSpecs 表条目(首冻为准)。
 * 完整性:rel 与 concern 一致;spec.concern 与 detail.concern 一致;
 * 同 concern 重复冻结同 spec 幂等,异 spec 抛错(凝固语义)。
 */
export function applyRenderSpecFrozen(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = frozenPayload(event);
  const rel = event.rel;
  if (rel === undefined || rel !== renderSpecRel(detail.concern)) {
    throw new Error(
      `重放失败:seq=${event.seq} render-spec-frozen 的 rel "${rel ?? ''}" 与 concern "${detail.concern}" 不一致(日志完整性)`,
    );
  }
  if (detail.spec.concern !== detail.concern) {
    throw new Error(
      `重放失败:seq=${event.seq} render-spec-frozen 的 spec.concern "${detail.spec.concern}" 与 detail.concern "${detail.concern}" 不一致(日志完整性)`,
    );
  }
  const existing = snapshot.renderSpecs?.[detail.concern];
  if (existing !== undefined) {
    // 同 spec 幂等;异 spec = 凝固语义破坏(比较用 JSON 序列化:载荷经同一
    // JSONB 往返,键序稳定)。
    if (JSON.stringify(entryOf(detail)) === JSON.stringify(existing)) {
      return snapshot;
    }
    throw new Error(
      `重放失败:seq=${event.seq} concern "${detail.concern}" 重复冻结且 spec 不同(凝固:同一关注点永远同一布局)`,
    );
  }
  return {
    ...snapshot,
    renderSpecs: { ...(snapshot.renderSpecs ?? {}), [detail.concern]: entryOf(detail) },
  };
}

function entryOf(detail: RenderSpecFrozenDetail): FrozenRenderSpec {
  return {
    concern: detail.concern,
    component: detail.spec.component,
    bind: detail.spec.bind,
    requestedBy: detail.requestedBy,
  };
}

/** 快照 → 已凝固 spec 条目列表(日志序;查询/投影的数据源)。 */
export function readRenderSpecsOf(snapshot: EngineSnapshot): FrozenRenderSpec[] {
  return Object.values(snapshot.renderSpecs ?? {});
}
