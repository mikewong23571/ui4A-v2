import { createHash } from 'node:crypto';

import {
  validateAgentDefinitionDraft,
  validateApplicationBundleDraft,
  validateFlowDraft,
  type ApplicationBundleDraftValidation,
  type ExecRequest,
} from '@ui4a/engine';
import { DRAFT_LIMITS } from '@ui4a/shared';

import { appendDraftCommand, payloadSha256, type ConnectableDb } from '@ui4a/db/drafts';
import type { EngineRuntime } from '../service';

import { applicationBundleInstalled } from './application-bundle';
import {
  AGENT_DEFINITION_SCHEMA_REF,
  APPLICATION_BUNDLE_SCHEMA_REF,
  FLOW_SCHEMA_REF,
  type AgentDefinitionDraftRegistryPort,
  type DraftMetaOutcome,
  validateAgentCandidate,
} from './views';
import {
  BARE_TARGET_NAME,
  persistedValidation,
  projectForOwner,
  registries,
  rejected,
  rejectionEvent,
  stringParam,
} from './helpers';

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
  const policyScope = context.policyScope;
  const commandId = stringParam(request, 'commandId');
  const payload = request.params?.payload;
  const sources = request.params?.sources;
  if (
    (kind !== 'flow-definition' && kind !== 'agent-definition' && kind !== 'application-bundle') ||
    target === undefined ||
    commandId === undefined ||
    payload === undefined
  ) {
    return rejected('schema-invalid', 'kind/target/commandId/payload are required');
  }
  if (
    sources !== undefined &&
    (!Array.isArray(sources) ||
      sources.length > 64 ||
      sources.some((source) => typeof source !== 'string' || source.length === 0))
  ) {
    return rejected('schema-invalid', 'sources must be at most 64 non-empty references');
  }
  let validation:
    | ReturnType<typeof validateFlowDraft>
    | ReturnType<typeof validateAgentDefinitionDraft>
    | ApplicationBundleDraftValidation;
  let baseVersion: string | undefined;
  if (kind === 'application-bundle') {
    // 裸名守卫(T50 D69.4,闭合 ui4a-ops GAP-4):target 必须是小写 kebab 裸
    // application 名——`application:` 等前缀形式不得绕过已安装冲突守卫进入
    // 提案;与 flow genesis 的 IDENTIFIER 共用同一常量口径。
    if (!BARE_TARGET_NAME.test(target)) {
      const outcome = rejected(
        'guard-failed',
        'application bundle target must be a bare application name',
      );
      await rejectionEvent(db, request, outcome);
      return outcome;
    }
    // 安装目标合同(I6):target 是待安装 application 名,不得与已安装冲突,
    // 且必须等于制品解析出的 bundle 名;不满足是 guard 拒绝事件,不是 Draft。
    const snapshot = await engine.readSnapshot();
    if (applicationBundleInstalled(snapshot, target)) {
      const outcome = rejected('guard-failed', `application ${target} is already installed`);
      await rejectionEvent(db, request, outcome);
      return outcome;
    }
    const parsed = validateApplicationBundleDraft(payload);
    if (parsed.value !== undefined && parsed.value.bundle.name !== target) {
      const outcome = rejected(
        'guard-failed',
        `target ${target} does not match bundle application name ${parsed.value.bundle.name}`,
      );
      await rejectionEvent(db, request, outcome);
      return outcome;
    }
    validation = parsed;
    // bundle 安装无基准版本(全新 application),baseVersion 保持 undefined。
  } else if (kind === 'flow-definition') {
    const snapshot = await engine.readSnapshot();
    const entry = snapshot.definitions?.[target];
    if (entry === undefined) {
      // flow-genesis(T48 Phase 4 / D67.3):target 不存在 → 提案新 flow。
      // 名称口径与 engine 标识符约定同形(agent-definition IDENTIFIER:kebab ≤64)。
      if (!BARE_TARGET_NAME.test(target)) {
        const outcome = rejected(
          'guard-failed',
          `target ${target} is not a valid flow name (expected [a-z][a-z0-9-]{0,63})`,
        );
        await rejectionEvent(db, request, outcome);
        return outcome;
      }
      validation = validateFlowDraft(payload, registries(snapshot));
      // 目标合同与 bundle/agent 同纪律:候选名必须等于 target;归属 lens 必须是
      // 凭证 policy scope(声明 lens)。不满足是 guard 拒绝事件(I6),不是 Draft。
      if (validation.value !== undefined && validation.value.name !== target) {
        const outcome = rejected(
          'guard-failed',
          `target ${target} does not match candidate flow name ${validation.value.name}`,
        );
        await rejectionEvent(db, request, outcome);
        return outcome;
      }
      if (
        validation.value !== undefined &&
        (validation.value.app ?? 'default') !== context.policyScope
      ) {
        const outcome = rejected(
          'guard-failed',
          'target flow is outside the credential policy scope',
        );
        await rejectionEvent(db, request, outcome);
        return outcome;
      }
      // genesis 无基准版本(全新 flow),baseVersion 保持 undefined。
    } else {
      const activeDefinition =
        snapshot.definitionVersions?.[target]?.[entry.version] ?? entry.definition;
      if ((activeDefinition.app ?? 'default') !== context.policyScope) {
        return rejected('guard-failed', 'target flow is outside the credential policy scope');
      }
      validation = validateFlowDraft(payload, registries(snapshot));
      baseVersion = String(entry.version);
    }
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
        kind === 'flow-definition'
          ? FLOW_SCHEMA_REF
          : kind === 'application-bundle'
            ? APPLICATION_BUNDLE_SCHEMA_REF
            : AGENT_DEFINITION_SCHEMA_REF,
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
