/**
 * 通用同步 capability materialization(自 service.ts 拆出,行为不变):LLM 已按
 * action schema 生成 output-param,spawn bind 只声明来源字段与输出参数名;本层把它
 * 物化为可重放 artifact。不识别 capability/action 业务名,缺少完整声明时保留 spawn
 * 事件但不造工件。
 */
import { createHash } from 'node:crypto';

import {
  applyCapabilityArtifactCreated,
  canonicalJson,
  type EngineEvent,
  type ExecRequest,
} from '@ui4a/engine';

import type { DbExecutor } from '@ui4a/db/events';
import { appendWithSeq, type CoreEventLogState } from './service-event-log';

/** 正式模型工件缺少部署 profile；调用方应映射为可恢复 503，而非内部错误。 */
export class LlmArtifactConfigurationError extends Error {
  readonly code = 'LLM_CONFIGURATION';

  constructor() {
    super('正式模型工件需要外部配置 LLM_MODEL；未写入任何业务事件，请配置后重试');
    this.name = 'LlmArtifactConfigurationError';
  }
}

export async function materializeSpawnArtifacts(
  db: DbExecutor,
  state: CoreEventLogState,
  events: readonly EngineEvent[],
  request: ExecRequest,
  model: string | undefined,
): Promise<void> {
  for (const event of events) {
    if (event.kind !== 'spawn-requested') continue;
    if (typeof event.capability !== 'string') continue;
    const sourceField = event.bind?.['source-field'];
    const outputParam = event.bind?.['output-param'];
    if (typeof sourceField !== 'string' || typeof outputParam !== 'string') continue;
    const source = state.snapshot.instances[request.rel]?.fields[sourceField];
    const output = request.params?.[outputParam];
    const capability = state.snapshot.capabilities?.[event.capability];
    if (source === undefined || output === undefined || capability === undefined) continue;
    if (model === undefined) {
      throw new Error('正式工件 materialization 缺少已预检的 LLM_MODEL(内部不变式破坏)');
    }

    const content = { [outputParam]: output };
    const canonicalContent = canonicalJson(content);
    const contentHash = `sha256:${createHash('sha256').update(canonicalContent).digest('hex')}`;
    const id = createHash('sha256')
      .update(
        canonicalJson({
          capability: event.capability,
          source: { rel: request.rel, field: sourceField },
          contentHash,
          model,
        }),
      )
      .digest('hex');
    const rel = `artifact:${id}`;
    const detail = {
      id,
      capability: event.capability,
      source: { rel: request.rel, field: sourceField },
      model,
      outputSchema: capability.outputSchema ?? { type: 'object' },
      content,
      contentHash,
      createdBy: {
        actor: request.actor ?? 'human',
        ...(request.principal !== undefined ? { principal: request.principal } : {}),
      },
      ...(request.identity === undefined ? {} : { identity: request.identity }),
    };
    const seq = await appendWithSeq(db, state, {
      kind: 'capability-artifact-created',
      rel,
      actor: request.actor ?? 'human',
      principal: request.principal,
      channel: 'capability',
      detail,
    });
    state.snapshot = applyCapabilityArtifactCreated(state.snapshot, { seq, rel, detail });
  }
}

/**
 * 只对确实会物化正式工件的 spawn 要求模型 profile。必须在 append outcome.events
 * 之前调用，避免 action-executed/spawn-requested 已写而 artifact 未写的半成品。
 */
export function artifactModelFor(
  state: CoreEventLogState,
  events: readonly EngineEvent[],
  request: ExecRequest,
): string | undefined {
  const materializes = events.some((event) => {
    if (event.kind !== 'spawn-requested' || typeof event.capability !== 'string') return false;
    const sourceField = event.bind?.['source-field'];
    const outputParam = event.bind?.['output-param'];
    if (typeof sourceField !== 'string' || typeof outputParam !== 'string') return false;
    return (
      state.snapshot.instances[request.rel]?.fields[sourceField] !== undefined &&
      request.params?.[outputParam] !== undefined &&
      state.snapshot.capabilities?.[event.capability] !== undefined
    );
  });
  if (!materializes) return undefined;
  const model = process.env.LLM_MODEL?.trim();
  if (model === undefined || model === '') throw new LlmArtifactConfigurationError();
  return model;
}
