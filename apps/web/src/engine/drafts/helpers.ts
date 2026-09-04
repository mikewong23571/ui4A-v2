import { type ExecRequest, type JudgeLayer, type SirenEntity } from '@ui4a/engine';
import { seedGuardRegistry, type DraftValidation } from '@ui4a/shared';

import { getDraftByOwner } from '@ui4a/db/drafts';
import { appendEvent, type DbExecutor } from '@ui4a/db/events';
import type { EngineRuntime } from '../service';
import {
  capabilityExecutorClassRegistryFromEnvironment,
  nativeFunctionActivationRegistryFromEnvironment,
} from '../capability/profile-config';

import {
  projectExactDraft,
  type AgentDefinitionDraftRegistryPort,
  type DraftMetaOutcome,
} from './views';

/**
 * genesis/安装目标名口径:与 engine 标识符约定同形(agent-definition
 * IDENTIFIER,见 packages/engine/src/agent-definition/parse.ts)——小写
 * kebab,≤64 字符。flow genesis(D67.3)与 application-bundle 裸名守卫
 * (T50 D69.4)共用同一常量,单一口径。
 */
export const BARE_TARGET_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export function rejected(layer: JudgeLayer, reason: string, detail?: unknown): DraftMetaOutcome {
  return detail === undefined
    ? { kind: 'rejected', layer, reason }
    : { kind: 'rejected', layer, reason, detail };
}

export function stringParam(request: ExecRequest, name: string): string | undefined {
  const value = request.params?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function registries(snapshot: ReturnType<EngineRuntime['getSnapshot']>) {
  return {
    guards: seedGuardRegistry,
    applications: new Set(Object.keys(snapshot.applications ?? {})),
    capabilities: new Set(Object.keys(snapshot.capabilities ?? {})),
    capabilityDefinitions: snapshot.capabilities ?? {},
    executorProfiles: capabilityExecutorClassRegistryFromEnvironment(),
    nativeFunctionProfiles: nativeFunctionActivationRegistryFromEnvironment(),
  };
}

/** Persist any Draft validator result (flow / agent-definition / application-bundle). */
export function persistedValidation(validation: DraftValidation): DraftValidation {
  return {
    valid: validation.valid,
    issues: validation.issues,
    ...(validation.validatedAgainst === undefined
      ? {}
      : { validatedAgainst: validation.validatedAgainst }),
  };
}

export async function rejectionEvent(
  db: DbExecutor,
  request: ExecRequest,
  outcome: DraftMetaOutcome,
) {
  if (outcome.kind !== 'rejected') return;
  await appendEvent(db, {
    kind: 'action-rejected',
    rel: request.rel,
    action: request.action,
    actor: request.actor,
    principal: request.principal,
    channel: request.channel,
    reason: outcome.reason,
    detail: { layer: outcome.layer, judge: outcome.detail, domain: 'draft' },
  });
}

export async function concurrentDecisionRejection(
  db: DbExecutor,
  request: ExecRequest,
  error: unknown,
): Promise<DraftMetaOutcome | undefined> {
  const message = error instanceof Error ? error.message : String(error);
  if (!/draft is (?:not pending|terminal)|draft version conflict/.test(message)) return undefined;
  const outcome = rejected('guard-failed', `draft decision conflict: ${message}`);
  await rejectionEvent(db, request, outcome);
  return outcome;
}

export async function projectForOwner(
  db: DbExecutor,
  engine: EngineRuntime,
  draftId: string,
  owner: string,
  agentDefinitions?: AgentDefinitionDraftRegistryPort,
): Promise<SirenEntity> {
  const found = await getDraftByOwner(db, draftId, owner);
  if (found === undefined) throw new Error('draft disappeared after command');
  return projectExactDraft(db, engine, found.aggregate, found.payload, agentDefinitions);
}

/** Server adapter for declared Draft/activation Siren actions. */
