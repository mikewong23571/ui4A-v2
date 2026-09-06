import type { DelegationSnapshot, EngineSnapshot } from '@ui4a/shared';
import { DELEGATIONS_REL, delegationRel } from '../../delegation/delegation';
import { collectionIdentity, entityHref } from './build';
import type { ProjectDeps, SirenEntity } from './types';

/**
 * 委托实体投影(T5 / spec 架构决定 2):class [delegation, status],
 * properties 含 goal/driver-kind/start-rel/principal/status/steps/successes
 * (+summary/reason);无动作(委托的每步操作走事件日志,不经实体动作面)。
 */
export function projectDelegation(delegation: DelegationSnapshot, deps: ProjectDeps): SirenEntity {
  return {
    class: ['delegation', delegation.status],
    properties: {
      id: delegation.id,
      rel: delegationRel(delegation.id),
      identity: delegation.goal.verb,
      goal: delegation.goal,
      'driver-kind': delegation.driverKind,
      ...(delegation.model !== undefined ? { model: delegation.model } : {}),
      'start-rel': delegation.startRel,
      ...(delegation.principal !== undefined ? { principal: delegation.principal } : {}),
      status: delegation.status,
      steps: delegation.steps,
      successes: delegation.successes,
      // T33"在动"进度行:机械计数派生(successes/steps + 状态),投影数据。
      resume: `${delegation.successes}/${delegation.steps} · ${delegation.status}`,
      ...(delegation.summary !== undefined ? { summary: delegation.summary } : {}),
      ...(delegation.reason !== undefined ? { reason: delegation.reason } : {}),
    },
    actions: [],
    // collection 回链 delegations(与确认实体同口径:状态终局后列表当次失效)。
    links: [
      { rel: ['self'], href: entityHref(deps.baseHref, delegationRel(delegation.id)) },
      { rel: ['collection'], href: entityHref(deps.baseHref, 'delegations') },
    ],
    'guard-results': [],
  };
}

/** delegations 集合投影(舰队页数据源):全部委托的集合实体,子实体直达。 */
export function projectDelegations(
  snapshot: EngineSnapshot,
  deps: ProjectDeps,
  currentOnly = false,
): SirenEntity {
  const rel = currentOnly ? 'delegations-current' : DELEGATIONS_REL;
  const entries = Object.values(snapshot.delegations ?? {}).filter(
    (entry) => !currentOnly || entry.status === 'running',
  );
  const entities = entries.map((delegation) => ({
    ...projectDelegation(delegation, deps),
    rel: ['item'],
    href: entityHref(deps.baseHref, delegationRel(delegation.id)),
  }));
  return {
    class: ['collection', DELEGATIONS_REL],
    properties: {
      rel,
      ...collectionIdentity(currentOnly ? '执行中委托' : '在动', 'nothing-in-motion'),
      count: entries.length,
    },
    actions: [],
    links: [
      {
        rel: ['self'],
        href: entityHref(deps.baseHref, rel),
        title: currentOnly ? '执行中委托' : '在动',
      },
      ...(currentOnly
        ? [
            {
              rel: ['collection'],
              href: entityHref(deps.baseHref, DELEGATIONS_REL),
              title: '全部委托',
            },
          ]
        : []),
    ],
    'guard-results': [],
    entities,
  };
}
