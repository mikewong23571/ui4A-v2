/**
 * 渲染 spec 凝固(自 service.ts 拆出,行为不变):串行队列内首冻追加
 * render-spec-frozen 事件并在线增量物化 renderSpecs 表;同 concern 二次请求
 * 直接返回已凝固(不追加事件)。入口校验(不合法抛错、不入日志):
 * 零字面校验器 + 词汇表词名 + concern 键一致(spec.concern === concern)。
 */
import { fold, renderSpecRel, type RenderSpecFrozenDetail } from '@ui4a/engine';
import type { FrozenRenderSpec } from '@ui4a/shared';

import type { DbExecutor } from '../db/events';
import type { RenderSpec } from '../render/spec';
import { validateSpec } from '../render/validator';
import { wordOf } from '../render/registry';
import { appendWithSeq, applyForeignGaps, type CoreEventLogState } from './service-event-log';

/**
 * 冻结结果:spec 为生效的已凝固 spec;frozen=true 本次首冻(事件已追加),
 * false = concern 已凝固,返回首冻 spec(首冻为准——"同一关注点永远同一布局")。
 */
export interface FreezeSpecResult {
  concern: string;
  frozen: boolean;
  spec: RenderSpec;
  requestedBy: { actor: 'human' | 'agent'; principal?: string };
}

/** 已凝固条目 → RenderSpec(bind 在凝固入口已过零字面校验,仅类型归属)。 */
export function toRenderSpec(frozen: FrozenRenderSpec): RenderSpec {
  return {
    concern: frozen.concern,
    component: frozen.component,
    // 断言理由:bind 经 freezeSpec 入口的零字面校验器把关后入日志,
    // 此处从 unknown 归属回 BindTree(渲染模块拥有该类型)。
    bind: frozen.bind as RenderSpec['bind'],
  };
}

/** 凝固主流程(调用方已在串行队列内并完成外部写者同步)。 */
export async function freezeSpecCore(
  db: DbExecutor,
  state: CoreEventLogState,
  concern: string,
  spec: RenderSpec,
  requestedBy?: { actor: 'human' | 'agent'; principal?: string },
): Promise<FreezeSpecResult> {
  // 入口校验(不合法不入日志):零字面剃刀 + 词汇表词名 + concern 键一致。
  const validation = validateSpec(spec);
  if (!validation.valid) {
    const summary = validation.errors.map((error) => `${error.path}: ${error.message}`);
    throw new Error(`render spec 校验失败:\n${summary.join('\n')}`);
  }
  if (spec.concern !== concern) {
    throw new Error(
      `凝固键不一致:concern 参数 "${concern}" 与 spec.concern "${spec.concern}" 必须相同`,
    );
  }
  if (wordOf(spec.component) === undefined) {
    throw new Error(`词条 "${spec.component}" 不在渲染词汇表(目录 /api/render/catalog)`);
  }
  const by = requestedBy ?? { actor: 'agent' as const };
  // 首冻为准:已凝固直接返回(同一关注点永远同一布局,不追加事件)。
  const existing = state.snapshot.renderSpecs?.[concern];
  if (existing !== undefined) {
    return {
      concern,
      frozen: false,
      spec: toRenderSpec(existing),
      requestedBy: existing.requestedBy,
    };
  }
  const detail: RenderSpecFrozenDetail = {
    concern,
    spec: { concern: spec.concern, component: spec.component, bind: spec.bind },
    requestedBy: by,
  };
  // 终审 H-1:走 appendWithSeq(多写者水位铁律)——裸 appendEvent +
  // lastSeq 推进会永久跳过 INSERT 窗口内挤入的外部事件(S5 与 S3 并跑
  // 的真实窗口);appendWithSeq 把区间收进 foreignGaps,末尾补折。
  const seq = await appendWithSeq(db, state, {
    kind: 'render-spec-frozen',
    rel: renderSpecRel(concern),
    actor: by.actor,
    ...(by.principal !== undefined ? { principal: by.principal } : {}),
    detail,
  });
  // 在线增量物化(与 fold 同构:同一 applyRenderSpecFrozen)。
  state.snapshot = fold(
    [
      {
        seq,
        kind: 'render-spec-frozen',
        rel: renderSpecRel(concern),
        actor: by.actor,
        ...(by.principal !== undefined ? { principal: by.principal } : {}),
        detail,
      },
    ],
    { flows: {} },
    state.snapshot,
  );
  applyForeignGaps(state);
  const frozen = state.snapshot.renderSpecs?.[concern];
  if (frozen === undefined) {
    throw new Error(`凝固后 renderSpecs 表缺 "${concern}"(内部不变式破坏)`);
  }
  return {
    concern,
    frozen: true,
    spec: toRenderSpec(frozen),
    requestedBy: frozen.requestedBy,
  };
}
