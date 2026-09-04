/**
 * 种子事件重放:seed(实体/集合合并,幂等)、application-seeded(T10)、
 * capability-seeded(T13)。只补缺、不覆盖——boot 重放安全。
 */
import type { EngineSnapshot } from '@ui4a/shared';
import { metaApplicationRel } from '@ui4a/shared';

import { APPLICATION_LIFECYCLE } from '../../definition/application-lifecycle/lifecycle';
import type {
  ApplicationSeededDetail,
  CapabilitySeededDetail,
  LogEvent,
  SeedDetail,
} from './log-event';
import type { FoldSnapshot } from './state';

/** seed 合并:只补缺、不覆盖(幂等种子装载;重复 seed 事件无害)。
 *  T4 Phase B:新装实例按当时活跃定义盖出生版本戳(空库序:定义先于业务 seed,
 *  天然可解析;定义未入日志的 flow 不盖戳,保持既有形状)。 */
export function applySeed(snapshot: FoldSnapshot, event: LogEvent): FoldSnapshot {
  const detail = event.detail as Partial<SeedDetail> | undefined;
  if (detail === undefined || typeof detail !== 'object' || detail.instances === undefined) {
    throw new Error(`seed 事件(seq=${event.seq})缺少 detail.instances`);
  }
  const instances: EngineSnapshot['instances'] = { ...snapshot.instances };
  for (const [rel, seeded] of Object.entries(detail.instances)) {
    if (instances[rel] !== undefined) continue;
    const bornVersion = seeded.bornVersion ?? snapshot.definitions?.[seeded.flow]?.version;
    instances[rel] = bornVersion !== undefined ? { ...seeded, bornVersion } : { ...seeded };
  }
  const collections: Record<string, string[]> = {};
  for (const [name, members] of Object.entries(snapshot.collections)) {
    collections[name] = [...members];
  }
  for (const [name, members] of Object.entries(detail.collections ?? {})) {
    const existing = collections[name] ?? [];
    collections[name] = [...existing, ...members.filter((rel) => !existing.includes(rel))];
  }
  return {
    instances,
    collections,
    // confirmations/definitions/activations 表随行(seed 只补实体与集合,
    // 不动确认门与定义平面状态;恒物化与在线路径同构)。
    confirmations: { ...snapshot.confirmations },
    // T5:delegations 表随行(seed 不产委托;与 confirmations 同口径)。
    delegations: { ...(snapshot.delegations ?? {}) },
    definitions: { ...snapshot.definitions },
    activations: { ...(snapshot.activations ?? {}) },
    definitionVersions: { ...(snapshot.definitionVersions ?? {}) },
    // T7:renderSpecs 表随行(seed 不产凝固;与 confirmations 同口径)。
    renderSpecs: { ...(snapshot.renderSpecs ?? {}) },
    artifacts: { ...(snapshot.artifacts ?? {}) },
    threads: { ...(snapshot.threads ?? {}) },
    // T10:applications 表随行,但仅在场时携带——缺省不物化为 {}
    // (app-known 以"表不存在"为过渡期 vacuous pass 信号;与 effects.ts 同口径)。
    ...(snapshot.applications !== undefined ? { applications: { ...snapshot.applications } } : {}),
    // T13:capabilities 表随行,与 applications 同口径(仅在场时携带,
    // 缺省不物化为 {}——capability-registered 的过渡期 vacuous pass 信号)。
    ...(snapshot.capabilities !== undefined ? { capabilities: { ...snapshot.capabilities } } : {}),
    // T52:deprecatedApplications 停用审计表随行,与 applications 同口径
    // (仅在场时携带;seed 只补实体与集合,不动停用审计)。
    ...(snapshot.deprecatedApplications !== undefined
      ? { deprecatedApplications: { ...snapshot.deprecatedApplications } }
      : {}),
  };
}

/**
 * application-seeded 重放:活跃 app 定义落 applications 表 + lifecycle 实例
 * (幂等:已存在跳过)。T52 Phase 3 起镜像 definition-seeded 的双轨
 * (definitions 表 + lifecycle 实例):meta/application:<name> 实例
 * (flow=application-lifecycle,seeded 即 active,node='active')是 deprecate
 * 裁决的宿主——此前「无 app 生命周期动词、不物化实例」的前提已随
 * APPLICATION_LIFECYCLE(D71.2)推翻。重放兼容:全量重放时 seeded 事件先于
 * deprecate,实例必在场;applications 表的键集即 app-known 不变式的已激活
 * 集合,表经本事件增长、经 application-deprecated(T52/D71.1)删键
 * (停用级联见 apply-application-deprecated)。
 */
export function applyApplicationSeeded(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<ApplicationSeededDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.name !== 'string' ||
    detail.definition === undefined
  ) {
    throw new Error(`重放失败:seq=${event.seq} application-seeded 缺少 detail 载荷(日志完整性)`);
  }
  const rel = metaApplicationRel(detail.name);
  const instanceSeeded = snapshot.instances[rel] !== undefined;
  if (snapshot.applications?.[detail.name] !== undefined && instanceSeeded) {
    return snapshot; // 幂等:重复 seed 不覆盖(boot 重放安全)。
  }
  return {
    ...snapshot,
    // 实例物化与表装载同批(仅缺时补;旧引擎折叠的增量快照缺实例时在此补齐)。
    instances: instanceSeeded
      ? snapshot.instances
      : {
          ...snapshot.instances,
          [rel]: { rel, flow: APPLICATION_LIFECYCLE, node: 'active', fields: {} },
        },
    applications: { ...(snapshot.applications ?? {}), [detail.name]: detail.definition },
  };
}

/**
 * capability-seeded 重放:已注册 capability 定义落 capabilities 表
 * (幂等:已存在跳过)。seeded 即 registered——capabilities 表的键集即
 * capability-registered 不变式(Phase D)的已注册集合;本 track 无
 * capability 生命周期动词,表只经本事件增长(与 application-seeded
 * 同哲学:不物化 lifecycle 实例)。
 */
export function applyCapabilitySeeded(snapshot: EngineSnapshot, event: LogEvent): EngineSnapshot {
  const detail = event.detail as Partial<CapabilitySeededDetail> | undefined;
  if (
    detail === undefined ||
    typeof detail !== 'object' ||
    typeof detail.name !== 'string' ||
    detail.definition === undefined
  ) {
    throw new Error(`重放失败:seq=${event.seq} capability-seeded 缺少 detail 载荷(日志完整性)`);
  }
  if (snapshot.capabilities?.[detail.name] !== undefined) {
    return snapshot; // 幂等:重复 seed 不覆盖(boot 重放安全)。
  }
  return {
    ...snapshot,
    capabilities: { ...(snapshot.capabilities ?? {}), [detail.name]: detail.definition },
  };
}
