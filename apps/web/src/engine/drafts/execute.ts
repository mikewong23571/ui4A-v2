import {
  validateAgentDefinitionDraft,
  validateFlowDraft,
  type ApplicationBundleDraftValidation,
  type ExecRequest,
} from '@ui4a/engine';
import Ajv from 'ajv';

import {
  acceptDraftWithCoreEvent,
  appendDraftCommand,
  getDraftByOwner,
  payloadSha256,
  type ConnectableDb,
} from '@ui4a/db/drafts';
import type { EngineRuntime } from '../service';

import {
  DRAFT_ACTIVATION_PREFIX,
  DRAFT_REL_PREFIX,
  getDraftMetaEntity,
  type AgentDefinitionDraftRegistryPort,
  projectExactDraft,
  type DraftMetaOutcome,
  validateAgentCandidate,
} from './views';
import {
  concurrentDecisionRejection,
  persistedValidation,
  projectForOwner,
  registries,
  rejected,
  rejectionEvent,
  stringParam,
} from './helpers';
import { applicationBundleInstalled, validateBundleCandidate } from './application-bundle';
import { planAgentDefinitionActivation } from './activate-agent';
import { planApplicationBundleActivation } from './activate-application';
import { planFlowDefinitionActivation } from './activate-flow';
import { executeDraftCreate } from './create';
export async function executeDraftMeta(
  db: ConnectableDb,
  engine: EngineRuntime,
  request: ExecRequest,
  context: { policyScope: string; agentDefinitions?: AgentDefinitionDraftRegistryPort },
): Promise<DraftMetaOutcome> {
  if (request.actor === undefined || request.principal === undefined || request.principal === '') {
    return rejected('guard-failed', 'Draft operations require an explicit resolved actor context');
  }
  const declaredEntity = await getDraftMetaEntity(
    db,
    engine,
    request.rel,
    request.principal,
    context.policyScope,
    context.agentDefinitions,
  );
  const declaration = declaredEntity?.actions.find((action) => action.name === request.action);
  if (declaration === undefined) {
    const outcome = rejected('undeclared', `action ${request.action} is not declared`);
    if (request.rel !== 'meta/drafts') await rejectionEvent(db, request, outcome);
    return outcome;
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  ajv.addFormat('textarea', true);
  const validate = ajv.compile(declaration.fields);
  if (!validate(request.params ?? {})) {
    return rejected('schema-invalid', '参数不符合 Draft action schema', validate.errors);
  }
  if (request.rel === 'meta/drafts') return executeDraftCreate(db, engine, request, context);

  const draftId = request.rel.startsWith(DRAFT_REL_PREFIX)
    ? request.rel.slice(DRAFT_REL_PREFIX.length)
    : request.rel.startsWith(DRAFT_ACTIVATION_PREFIX)
      ? request.rel.slice(DRAFT_ACTIVATION_PREFIX.length)
      : undefined;
  if (draftId === undefined) return rejected('undeclared', 'not a Draft resource');
  const found = await getDraftByOwner(db, draftId, request.principal);
  if (found === undefined) {
    const outcome = rejected('undeclared', 'Draft is not authorized or does not exist');
    await rejectionEvent(db, request, outcome);
    return outcome;
  }
  const { aggregate, payload } = found;
  if (aggregate.policyScope !== context.policyScope) {
    const outcome = rejected('undeclared', 'Draft is not authorized or does not exist');
    await rejectionEvent(db, request, outcome);
    return outcome;
  }
  const commandId = stringParam(request, 'commandId');

  if (request.rel.startsWith(DRAFT_ACTIVATION_PREFIX)) {
    if (request.action !== 'approve' && request.action !== 'reject') {
      return rejected('undeclared', `action ${request.action} is not declared`);
    }
    if (request.actor !== 'human') {
      const outcome = rejected('guard-failed', 'actor-is-human=false');
      await rejectionEvent(db, request, outcome);
      return outcome;
    }
    if (commandId === undefined) return rejected('schema-invalid', 'commandId is required');
    if (request.action === 'reject') {
      const reason = stringParam(request, 'reason');
      if (reason === undefined) return rejected('schema-invalid', 'reason is required');
      try {
        await appendDraftCommand(db, {
          kind: 'reject',
          eventId: `event:${commandId}`,
          commandId,
          draftId,
          activeVersion: aggregate.activeVersion,
          reason,
        });
      } catch (error) {
        const conflict = await concurrentDecisionRejection(db, request, error);
        if (conflict !== undefined) return conflict;
        throw error;
      }
      return {
        kind: 'accepted',
        entity: (await getDraftMetaEntity(
          db,
          engine,
          request.rel,
          request.principal,
          aggregate.policyScope,
          context.agentDefinitions,
        ))!,
      };
    }
    let accepted: Awaited<ReturnType<typeof acceptDraftWithCoreEvent>>;
    try {
      accepted = await engine.runExclusive(() =>
        acceptDraftWithCoreEvent(
          db,
          {
            kind: 'accept',
            eventId: `event:${commandId}`,
            commandId,
            draftId,
            activeVersion: aggregate.activeVersion,
          },
          ({ client, aggregate: locked, payload: lockedPayload }) => {
            if (locked.target === undefined) throw new Error('Draft target is missing');
            if (locked.kind === 'flow-definition') {
              return planFlowDefinitionActivation({
                client,
                locked,
                payload: lockedPayload,
                commandId,
                draftId,
                request,
              });
            }
            if (locked.kind === 'agent-definition') {
              if (context.agentDefinitions === undefined) {
                throw new Error('unsupported Draft kind');
              }
              return planAgentDefinitionActivation({
                client,
                locked,
                payload: lockedPayload,
                commandId,
                draftId,
                request,
                agentDefinitions: context.agentDefinitions,
              });
            }
            if (locked.kind === 'application-bundle') {
              return planApplicationBundleActivation({ client, locked, payload: lockedPayload });
            }
            throw new Error('unsupported Draft kind');
          },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const conflict = await concurrentDecisionRejection(db, request, error);
      if (conflict !== undefined) return conflict;
      if (/stale|version changed/.test(message)) {
        await appendDraftCommand(db, {
          kind: 'stale',
          eventId: `event:${commandId}:stale`,
          commandId: `${commandId}:stale`,
          draftId,
          activeVersion: aggregate.activeVersion,
          reason: message,
        });
      }
      throw error;
    }
    await engine.readSnapshot();
    return {
      kind: 'accepted',
      entity: await projectForOwner(
        db,
        engine,
        accepted.aggregate.id,
        request.principal,
        context.agentDefinitions,
      ),
    };
  }

  if (request.action === 'diff') {
    return {
      kind: 'accepted',
      entity: await projectExactDraft(db, engine, aggregate, payload, context.agentDefinitions),
    };
  }
  if (commandId === undefined) return rejected('schema-invalid', 'commandId is required');
  if (request.action === 'revise') {
    const baseVersion = request.params?.baseVersion;
    const nextPayload = request.params?.payload;
    if (!Number.isInteger(baseVersion) || nextPayload === undefined)
      return rejected('schema-invalid', 'baseVersion and payload are required');
    let validation:
      | ReturnType<typeof validateFlowDraft>
      | ReturnType<typeof validateAgentDefinitionDraft>
      | ApplicationBundleDraftValidation;
    if (aggregate.kind === 'flow-definition') {
      const snapshot = await engine.readSnapshot();
      validation = validateFlowDraft(nextPayload, registries(snapshot));
    } else if (aggregate.kind === 'application-bundle') {
      validation = validateBundleCandidate(nextPayload, aggregate.target);
    } else if (aggregate.kind === 'agent-definition' && context.agentDefinitions !== undefined) {
      const registry = await context.agentDefinitions.readSnapshot({
        db,
        owner: aggregate.owner,
        policyScope: aggregate.policyScope,
      });
      validation = validateAgentCandidate(nextPayload, aggregate.target, registry);
    } else {
      return rejected('guard-failed', 'Draft validator is unavailable');
    }
    await appendDraftCommand(
      db,
      {
        kind: 'revise',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        baseVersion: baseVersion as number,
        ...(stringParam(request, 'targetBaseVersion') === undefined
          ? {}
          : { targetBaseVersion: stringParam(request, 'targetBaseVersion') }),
        payloadHash: payloadSha256(nextPayload),
        schemaRef: aggregate.versions[aggregate.activeVersion]!.schemaRef,
        provenance: { actor: request.actor, principal: request.principal, commandId, sources: [] },
        validation: persistedValidation(validation),
      },
      nextPayload,
    );
  } else if (request.action === 'validate') {
    let staleReason: string | undefined;
    let validation:
      | ReturnType<typeof validateFlowDraft>
      | ReturnType<typeof validateAgentDefinitionDraft>
      | ApplicationBundleDraftValidation;
    if (aggregate.kind === 'flow-definition') {
      const snapshot = await engine.readSnapshot();
      const current =
        aggregate.target === undefined ? undefined : snapshot.definitions?.[aggregate.target];
      if (current !== undefined && String(current.version) !== aggregate.baseVersion) {
        staleReason = `base ${aggregate.baseVersion}, current ${current.version}`;
      }
      validation = validateFlowDraft(payload, registries(snapshot));
    } else if (aggregate.kind === 'application-bundle') {
      const snapshot = await engine.readSnapshot();
      // bundle 的基准是"target 名尚未被安装";此后同名被安装(冲突出现)即 stale。
      if (applicationBundleInstalled(snapshot, aggregate.target)) {
        staleReason = `application ${aggregate.target} is already installed`;
      }
      validation = validateBundleCandidate(payload, aggregate.target);
    } else if (aggregate.kind === 'agent-definition' && context.agentDefinitions !== undefined) {
      const registry = await context.agentDefinitions.readSnapshot({
        db,
        owner: aggregate.owner,
        policyScope: aggregate.policyScope,
      });
      const current =
        aggregate.target === undefined ? undefined : registry.activeByName.get(aggregate.target);
      if (current !== aggregate.baseVersion) {
        staleReason = `base ${aggregate.baseVersion ?? '(none)'}, current ${current ?? '(none)'}`;
      }
      validation = validateAgentCandidate(payload, aggregate.target, registry);
    } else {
      return rejected('guard-failed', 'Draft validator is unavailable');
    }
    if (staleReason !== undefined) {
      await appendDraftCommand(db, {
        kind: 'stale',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        activeVersion: aggregate.activeVersion,
        reason: staleReason,
      });
    } else {
      await appendDraftCommand(db, {
        kind: 'validate',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        activeVersion: aggregate.activeVersion,
        validation: persistedValidation(validation),
      });
    }
  } else if (request.action === 'submit') {
    if (aggregate.status !== 'ready')
      return rejected('guard-failed', 'only ready Draft can be submitted');
    await appendDraftCommand(db, {
      kind: 'submit',
      eventId: `event:${commandId}`,
      commandId,
      draftId,
      activeVersion: aggregate.activeVersion,
      activation: `${DRAFT_ACTIVATION_PREFIX}${draftId}`,
    });
  } else if (request.action === 'abandon') {
    try {
      await appendDraftCommand(db, {
        kind: 'abandon',
        eventId: `event:${commandId}`,
        commandId,
        draftId,
        activeVersion: aggregate.activeVersion,
        ...(stringParam(request, 'reason') === undefined
          ? {}
          : { reason: stringParam(request, 'reason') }),
      });
    } catch (error) {
      const conflict = await concurrentDecisionRejection(db, request, error);
      if (conflict !== undefined) return conflict;
      throw error;
    }
  } else {
    return rejected('undeclared', `action ${request.action} is not declared`);
  }
  return {
    kind: 'accepted',
    entity: await projectForOwner(db, engine, draftId, request.principal, context.agentDefinitions),
  };
}

export function isDraftMetaRel(rel: string): boolean {
  return (
    rel === 'meta/drafts' ||
    rel.startsWith(DRAFT_REL_PREFIX) ||
    rel.startsWith(DRAFT_ACTIVATION_PREFIX)
  );
}
