import { createHash } from 'node:crypto';

import { validateAgentDefinitionDraft, validateFlowDraft, type ExecRequest } from '@ui4a/engine';
import { DRAFT_LIMITS } from '@ui4a/shared';

import { appendDraftCommand, payloadSha256, type ConnectableDb } from '@ui4a/db/drafts';
import type { EngineRuntime } from '../service';

import {
  AGENT_DEFINITION_SCHEMA_REF,
  FLOW_SCHEMA_REF,
  type AgentDefinitionDraftRegistryPort,
  type DraftMetaOutcome,
  validateAgentCandidate,
} from './views';
import { persistedValidation, projectForOwner, registries, rejected, stringParam } from './helpers';

export async function executeDraftCreate(
  db: ConnectableDb,
  engine: EngineRuntime,
  request: ExecRequest,
  context: { policyScope: string; agentDefinitions?: AgentDefinitionDraftRegistryPort },
): Promise<DraftMetaOutcome> {
  // executeDraftMeta 已做过同一守卫;独立成函数后在此重复以恢复 actor/principal 窄化。
  if (request.actor === undefined || request.principal === undefined || request.principal === '') {
    return rejected('guard-failed', 'Draft operations require an explicit resolved actor context');
  }
  if (request.action !== 'create')
    return rejected('undeclared', `action ${request.action} is not declared`);
  const kind = stringParam(request, 'kind');
  const target = stringParam(request, 'target');
  const policyScope = stringParam(request, 'policyScope');
  const commandId = stringParam(request, 'commandId');
  const payload = request.params?.payload;
  const sources = request.params?.sources;
  if (
    (kind !== 'flow-definition' && kind !== 'agent-definition') ||
    target === undefined ||
    policyScope === undefined ||
    commandId === undefined ||
    payload === undefined
  ) {
    return rejected('schema-invalid', 'kind/target/policyScope/commandId/payload are required');
  }
  if (
    sources !== undefined &&
    (!Array.isArray(sources) ||
      sources.length > 64 ||
      sources.some((source) => typeof source !== 'string' || source.length === 0))
  ) {
    return rejected('schema-invalid', 'sources must be at most 64 non-empty references');
  }
  if (policyScope !== context.policyScope) {
    return rejected('guard-failed', 'request policy scope does not match credential scope');
  }
  let validation:
    ReturnType<typeof validateFlowDraft> | ReturnType<typeof validateAgentDefinitionDraft>;
  let baseVersion: string | undefined;
  if (kind === 'flow-definition') {
    const snapshot = await engine.readSnapshot();
    const entry = snapshot.definitions?.[target];
    if (entry === undefined)
      return rejected('guard-failed', 'target flow is not authorized or does not exist');
    const activeDefinition =
      snapshot.definitionVersions?.[target]?.[entry.version] ?? entry.definition;
    if ((activeDefinition.app ?? 'default') !== context.policyScope) {
      return rejected('guard-failed', 'target flow is outside the credential policy scope');
    }
    validation = validateFlowDraft(payload, registries(snapshot));
    baseVersion = String(entry.version);
  } else {
    if (context.agentDefinitions === undefined) {
      return rejected('guard-failed', 'Agent Definition registry is unavailable');
    }
    const registry = await context.agentDefinitions.readSnapshot({
      db,
      owner: request.principal,
      policyScope,
    });
    validation = validateAgentCandidate(payload, target, registry);
    baseVersion = registry.activeByName.get(target);
  }
  const id = createHash('sha256')
    .update(`${request.principal}\0${policyScope}\0${commandId}`)
    .digest('hex')
    .slice(0, 20);
  await appendDraftCommand(
    db,
    {
      kind: 'create',
      eventId: `event:${commandId}`,
      commandId,
      draftId: id,
      owner: request.principal,
      policyScope,
      draftKind: kind,
      target,
      ...(baseVersion === undefined ? {} : { baseVersion }),
      payloadHash: payloadSha256(payload),
      schemaRef:
        stringParam(request, 'schemaRef') ??
        (kind === 'flow-definition' ? FLOW_SCHEMA_REF : AGENT_DEFINITION_SCHEMA_REF),
      provenance: {
        actor: request.actor,
        principal: request.principal,
        commandId,
        sources: sources === undefined ? [] : [...(sources as string[])],
      },
      validation: persistedValidation(validation),
      expiresAt: new Date(Date.now() + DRAFT_LIMITS.retentionDays * 86_400_000).toISOString(),
    },
    payload,
  );
  return {
    kind: 'accepted',
    entity: await projectForOwner(db, engine, id, request.principal, context.agentDefinitions),
  };
}
