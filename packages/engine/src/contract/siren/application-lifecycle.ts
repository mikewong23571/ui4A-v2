/**
 * meta 平面应用实体的 lifecycle 投影(T52 Phase 3;D71.2/D71.3/D71.6)。
 *
 * 自 project-meta.ts 迁入(GR3:project-meta.ts 已 485/500 行,镜像逻辑一律
 * 落本文件,project-meta.ts 只留路由接线)。纪律与定义实体
 * (lifecycleActionsForStatus)同构:动作声明取自 APPLICATION_LIFECYCLE
 * 常量的对应状态节点。
 *
 * 存在性隐藏(D71.3 + spec §5 US5,铁口径):实体面只从 applications
 * **active 表**取数——停用的应用经 application-deprecated 级联删键后,
 * projectMetaApplication 返回 undefined(路由 404),对所有主体存在性隐藏;
 * **禁止从 deprecatedApplications 投影实体**(审计集只服务受众解析与烧毁集,
 * 审计经事件日志,不在实体面)。因此可投影的应用必在 active 表,
 * properties.status 恒 'active'。
 *
 * default 地板(D71.6)在 guard-results 投影可见:同一个谓词的两个投影
 * (按钮 disabled 与 agent 看到的拒绝同源;投影无 actor 上下文 fail-closed)。
 */
import { META_CAPABILITY_PREFIX, metaApplicationRel } from '@ui4a/shared';

import { APPLICATION_LIFECYCLE_FLOW } from '../../definition/application-lifecycle/lifecycle';
import { exportDefinitionBundle } from '../../definition/definition-bundle';
import type { ActionDefinition } from '../../core/types';
import { projectCognitiveSemantics } from '../cognitive-semantics';
import type { FoldSnapshot } from '../../projection/fold/index';
import { entityHref, guardResultsFor, toSirenAction } from './build';
import { metaMemberPresentation, metaTopLevelPresentation } from './meta-presentation';
import type { ProjectDeps, SirenEntity } from './types';

/** 投影可见的应用生命周期状态(实体面只投影 active 表;deprecated = 隐藏)。 */
export type ApplicationProjectionStatus = 'active' | 'deprecated';

/**
 * 状态对应的停用动词(自举:动作声明取自 APPLICATION_LIFECYCLE 对应节点)。
 * deprecated 分支为防御性空数组——实体面不投影停用应用(存在性隐藏),
 * 该分支实际不可达,保留以显式表达语义。
 */
export function applicationLifecycleActionsForStatus(
  status: ApplicationProjectionStatus,
): ActionDefinition[] {
  const node = APPLICATION_LIFECYCLE_FLOW.nodes.find((candidate) => candidate.name === status);
  return node?.actions ?? [];
}

/**
 * meta/application:<name> 实体投影:只从 applications active 表取数——
 * 键在 → 定义全文 + bundle + deprecate 动作镜像 + guard-results;键被停用
 * 级联删除 → undefined(HTTP 层映射 404,对所有主体存在性隐藏,D71.3/US5)。
 */
export function projectMetaApplication(
  snapshot: FoldSnapshot,
  name: string,
  deps: ProjectDeps,
): SirenEntity | undefined {
  const application = snapshot.applications?.[name];
  if (application === undefined) return undefined;
  const rel = metaApplicationRel(name);
  const bundle = exportDefinitionBundle(snapshot, name);
  const presentation = projectCognitiveSemantics({ declaration: application.cognitive });
  const actions = applicationLifecycleActionsForStatus('active');
  const instance = snapshot.instances[rel];
  return {
    class: ['meta', 'application-definition'],
    properties: {
      rel,
      ...application,
      status: 'active' as const,
      version: bundle.bundle.version,
      bundle,
      ...(presentation === undefined ? {} : { presentation }),
    },
    actions: actions.map((action) => toSirenAction(action, [], deps.baseHref)),
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, rel) },
      { rel: ['collection'], href: entityHref(deps.baseHref, 'meta/applications') },
      ...bundle.flows.map((flow) => ({
        rel: ['flow'],
        href: entityHref(deps.baseHref, `meta/flow:${flow.name}`),
        ...(flow.title === undefined ? {} : { title: flow.title }),
      })),
      ...bundle.capabilities.map((capability) => ({
        rel: ['capability'],
        href: entityHref(deps.baseHref, `${META_CAPABILITY_PREFIX}${capability.name}`),
        title: capability.title,
      })),
    ],
    'guard-results':
      instance !== undefined ? guardResultsFor(actions, instance, snapshot, deps.guards) : [],
  };
}

/**
 * meta/applications 集合:成员只源自 applications active 键集(停用成员经
 * 级联删键天然出局——P3b 钉测);summary 的 status 与单实体同口径恒
 * 'active'。deprecatedApplications 审计集不进实体面(D71.3)。
 */
export function projectMetaApplications(snapshot: FoldSnapshot, deps: ProjectDeps): SirenEntity {
  const names = Object.keys(snapshot.applications ?? {});
  const entities = names.map((name) => {
    const application = snapshot.applications![name]!;
    const bundle = exportDefinitionBundle(snapshot, name);
    return {
      class: ['meta', 'application-definition-summary'],
      properties: {
        name,
        title: application.title,
        intent: application.intent,
        status: 'active' as const,
        version: bundle.bundle.version,
        flowCount: bundle.flows.length,
        capabilityCount: bundle.capabilities.length,
        policyCount: bundle.policies.length,
        presentation: metaMemberPresentation('application'),
      },
      actions: [],
      links: [],
      'guard-results': [],
      rel: ['item'],
      href: entityHref(deps.baseHref, metaApplicationRel(name)),
    };
  });
  return {
    class: ['collection', 'meta/applications'],
    properties: {
      rel: 'meta/applications',
      count: names.length,
      // 顶层认知投影按 wire 惯例嵌套在 properties.presentation 下
      // (同 project-meta.ts 其余集合的 topLevelPresentationProperties 口径)。
      ...(metaTopLevelPresentation('meta/applications') === undefined
        ? {}
        : { presentation: metaTopLevelPresentation('meta/applications') }),
    },
    actions: [],
    links: [{ rel: ['self'], href: entityHref(deps.baseHref, 'meta/applications') }],
    'guard-results': [],
    entities,
  };
}
