/**
 * spawn-dispatch 准备与派发(T55/D76 自 service.ts exec 闭包迁入,行为逐字):
 * - prepareSpawnPlan:capability 产物模型 + 逐 spawn-requested 事件准备 dispatch
 *   (capability/executor 缺失跳过;源实例缺失即内部不变式错误);principal 缺省
 *   local-user,policyScope 取源实例活跃定义的 app(缺省 default);
 * - dispatchSpawnPlan:落库拿到日志层 seq 后派发——native-function 直启;agent
 *   走 Agent Run 派发 + 失败回调留痕(域语义同 service-capability-callback);
 *   prepared 缺失即抛(准备/派发必须成对)。
 */
import {
  activeDefinitionOf,
  type EngineEvent,
  type ExecRequest,
  type ExecuteDeps,
} from '@ui4a/engine';

import type { DbExecutor } from '@ui4a/db/events';
import { runWebProductionDeploymentPreflight } from '../../production-deployment-preflight';
import { dispatchNativeFunction } from '../../temporal/native-function';
import {
  createAndDispatchAgentRun,
  prepareNativeAgentDispatch,
  type PreparedNativeAgentDispatch,
} from '../agent/native-agent-dispatch';
import {
  prepareCapabilityDispatch,
  startNativeFunctionDispatch,
  type PreparedCapabilityDispatch,
} from '../capability/dispatch';
import { nativeFunctionProfileMapFromEnvironment } from '../capability/profile-config';
import { artifactModelFor } from '../service-artifacts';
import { capabilityArtifactsForRequest } from '../service-request';
import type { CoreEventLogState } from '../service-event-log';
import { persistFailedAgentDispatchCallback } from '../service-capability-callback';

export interface SpawnPlan {
  artifactModel: ReturnType<typeof artifactModelFor>;
  effectiveEvents: readonly EngineEvent[];
  preparedDispatches: Map<EngineEvent, PreparedCapabilityDispatch<PreparedNativeAgentDispatch>>;
  spawnPrincipal: string;
  spawnPolicyScope: string;
}

export async function prepareSpawnPlan(args: {
  db: DbExecutor;
  logState: CoreEventLogState;
  aliased: ExecRequest;
  effectiveEvents: readonly EngineEvent[];
  productionConfig?: ReturnType<typeof runWebProductionDeploymentPreflight>;
}): Promise<SpawnPlan> {
  const { db, logState, aliased, effectiveEvents, productionConfig } = args;
  const artifactModel = artifactModelFor(logState, effectiveEvents, aliased);
  const sourceInstance = logState.snapshot.instances[aliased.rel];
  const spawnPolicyScope =
    (sourceInstance === undefined
      ? undefined
      : activeDefinitionOf(logState.snapshot, sourceInstance.flow)?.app) ?? 'default';
  const spawnPrincipal = aliased.principal ?? 'local-user';
  const preparedDispatches = new Map<
    EngineEvent,
    PreparedCapabilityDispatch<PreparedNativeAgentDispatch>
  >();
  const nativeFunctionProfiles = nativeFunctionProfileMapFromEnvironment();
  for (const event of effectiveEvents) {
    if (event.kind !== 'spawn-requested' || typeof event.capability !== 'string') continue;
    const capability = logState.snapshot.capabilities?.[event.capability];
    if (capability === undefined) continue;
    if (capability.executor === undefined) continue;
    if (sourceInstance === undefined) throw new Error('spawn source instance is missing');
    preparedDispatches.set(
      event,
      await prepareCapabilityDispatch(
        {
          event,
          capability,
          principal: spawnPrincipal,
          policyScope: spawnPolicyScope,
          actionParams: aliased.params ?? {},
          source: { rel: sourceInstance.rel, fields: sourceInstance.fields },
          artifacts: capabilityArtifactsForRequest(aliased, logState.snapshot, sourceInstance.rel),
        },
        {
          nativeFunctionProfiles,
          prepareAgent: async () =>
            prepareNativeAgentDispatch(db, {
              principal: spawnPrincipal,
              policyScope: spawnPolicyScope,
              params: aliased.params ?? {},
              capability,
              ...(productionConfig === undefined ? {} : { productionConfig }),
            }),
        },
      ),
    );
  }
  return {
    artifactModel,
    effectiveEvents,
    preparedDispatches,
    spawnPrincipal,
    spawnPolicyScope,
  };
}

export async function dispatchSpawnPlan(args: {
  db: DbExecutor;
  logState: CoreEventLogState;
  plan: SpawnPlan;
  effectiveSeqs: readonly number[];
  aliased: ExecRequest;
  gateDeps: () => ExecuteDeps;
}): Promise<void> {
  const { db, logState, plan, effectiveSeqs, aliased, gateDeps } = args;
  const spawned: {
    event: EngineEvent;
    seq: number;
    prepared?: PreparedCapabilityDispatch<PreparedNativeAgentDispatch>;
  }[] = [];
  for (const [index, event] of plan.effectiveEvents.entries()) {
    const seq = effectiveSeqs[index]!;
    if (event.kind === 'spawn-requested') {
      const prepared = plan.preparedDispatches.get(event);
      spawned.push({ event, seq, ...(prepared === undefined ? {} : { prepared }) });
    }
  }
  for (const { event, seq, prepared } of spawned) {
    if (event.kind !== 'spawn-requested' || typeof event.capability !== 'string') continue;
    const capability = logState.snapshot.capabilities?.[event.capability];
    if (capability?.executor === undefined) continue;
    if (prepared === undefined) throw new Error('spawn dispatch missed its prepared executor');
    if (prepared.kind === 'native-function') {
      await startNativeFunctionDispatch(prepared.prepared, seq, {
        start: dispatchNativeFunction,
      });
      continue;
    }
    const run = await createAndDispatchAgentRun(db, {
      prepared: prepared.prepared,
      sourceSeq: seq,
      sourceRel: aliased.rel,
      sourceAction: aliased.action,
      principal: plan.spawnPrincipal,
      policyScope: plan.spawnPolicyScope,
      onDoneAction: event['on-done'],
      onErrorAction: event['on-error'],
    });
    await persistFailedAgentDispatchCallback(db, logState, run, gateDeps());
  }
}
