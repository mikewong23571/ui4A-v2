import Ajv from 'ajv';

import {
  parseThreadEventDetail,
  type EngineSnapshot,
  type ThreadEventKind,
  type ThreadJudgmentReceipt,
  type ThreadReferenceCategory,
  type ThreadStatus,
} from '@ui4a/shared';

import { fieldDefinitionsToJsonSchema } from '../contract/schema';
import type { ActionDefinition } from '../core/types';
import type { EngineEvent } from '../execution/effects';
import type { ExecRequest, JudgeLayer } from '../execution/judge';
import { applyThreadEvent } from './fold/apply-thread';
import {
  THREADS_REL,
  THREAD_REL_PREFIX,
  THREAD_CREATE_ACTION,
  threadActionsForStatus,
  threadRel,
} from './work-thread';

type Rejected = { kind: 'rejected'; layer: JudgeLayer; reason: string; detail?: unknown };
export type ThreadCommandOutcome =
  | {
      kind: 'accepted';
      snapshot: EngineSnapshot;
      event: EngineEvent & { kind: ThreadEventKind };
      entityRel: string;
    }
  | Rejected;

const statusByAction: Readonly<Record<string, ThreadStatus>> = {
  pause: 'paused',
  resume: 'open',
  complete: 'completed',
  archive: 'archived',
};

function rejected(layer: JudgeLayer, reason: string, detail?: unknown): Rejected {
  return detail === undefined
    ? { kind: 'rejected', layer, reason }
    : { kind: 'rejected', layer, reason, detail };
}

function declaration(
  request: ExecRequest,
  snapshot: EngineSnapshot,
): { action: ActionDefinition; threadId?: string } | Rejected {
  if (request.rel === THREADS_REL) {
    return request.action === THREAD_CREATE_ACTION.name
      ? { action: THREAD_CREATE_ACTION }
      : rejected('undeclared', `动作 "${request.action}" 未声明于 threads 集合`);
  }
  if (!request.rel.startsWith(THREAD_REL_PREFIX)) {
    return rejected('undeclared', `实体 "${request.rel}" 不是 Work Thread 资源`);
  }
  const threadId = request.rel.slice(THREAD_REL_PREFIX.length);
  const thread = snapshot.threads?.[threadId];
  if (thread === undefined) return rejected('undeclared', `实体 "${request.rel}" 不存在`);
  const action = threadActionsForStatus(thread.status).find(
    (candidate) => candidate.name === request.action,
  );
  return action === undefined
    ? rejected('undeclared', `动作 "${request.action}" 未声明于 ${thread.status} Work Thread`)
    : { action, threadId };
}

function ownerGuards(
  request: ExecRequest,
  snapshot: EngineSnapshot,
  threadId: string | undefined,
): { pass: true; guards: Array<{ name: string; pass: true }> } | Rejected {
  if (typeof request.principal !== 'string' || request.principal.trim() === '') {
    return rejected('guard-failed', 'guard 不满足: thread-owner=false', [
      { name: 'thread-owner', pass: false },
    ]);
  }
  if (threadId !== undefined && snapshot.threads?.[threadId]?.owner !== request.principal) {
    return rejected('guard-failed', 'guard 不满足: thread-owner=false', [
      { name: 'thread-owner', pass: false },
    ]);
  }
  return { pass: true, guards: [{ name: 'thread-owner', pass: true }] };
}

function receipt(
  guards: Array<{ name: string; pass: true }>,
  authorization: ExecRequest['authorization'],
): ThreadJudgmentReceipt {
  return {
    declaration: { passed: true },
    guards,
    schema: { passed: true },
    confirmation: { required: false, status: 'not-required' },
    ...(authorization === undefined ? {} : { authorization: { ...authorization } }),
  };
}

function detailFor(
  request: ExecRequest,
  threadId: string | undefined,
  judgment: ThreadJudgmentReceipt,
): { kind: ThreadEventKind; detail: unknown; entityRel: string } {
  const params = request.params ?? {};
  if (request.rel === THREADS_REL) {
    const id = params.id;
    return {
      kind: 'thread-created',
      detail: {
        threadId: id,
        owner: request.principal,
        goal: { text: params.goal, source: params.goalSource },
        receipt: judgment,
      },
      entityRel: threadRel(String(id)),
    };
  }
  const id = threadId!;
  if (request.action === 'attach' || request.action === 'detach') {
    return {
      kind: request.action === 'attach' ? 'thread-reference-attached' : 'thread-reference-detached',
      detail: {
        threadId: id,
        category: params.category as ThreadReferenceCategory,
        rel: params.rel,
        source: request.channel === 'chat-presence' ? 'presence' : 'action',
        receipt: judgment,
      },
      entityRel: request.rel,
    };
  }
  return {
    kind: 'thread-status-changed',
    detail: { threadId: id, status: statusByAction[request.action], receipt: judgment },
    entityRel: request.rel,
  };
}

/** Declaration → trusted-owner guard → strict JSON schema/parser → one dedicated core event. */
export function executeThreadCommand(
  request: ExecRequest,
  snapshot: EngineSnapshot,
): ThreadCommandOutcome {
  const declared = declaration(request, snapshot);
  if ('kind' in declared) return declared;
  const guarded = ownerGuards(request, snapshot, declared.threadId);
  if ('kind' in guarded) return guarded;

  // D48 裁决(a):thread-id-available 是 guard 层判定,先于参数 schema 校验执行,
  // 使 declaration → guard → schema 机械层序与拒绝分类同时成立。id 与 detailFor
  // thread-created 分支同源取 request.params.id;非字符串 id 不做存在性判断,
  // 留给 schema 层拒绝;存在性判定用自有属性,不被继承键误触发。
  if (request.rel === THREADS_REL) {
    const requestedId = request.params?.id;
    if (
      typeof requestedId === 'string' &&
      Object.hasOwn(snapshot.threads ?? {}, requestedId)
    ) {
      return rejected('guard-failed', 'guard 不满足: thread-id-available=false', [
        { name: 'thread-id-available', pass: false },
      ]);
    }
  }

  const schema = fieldDefinitionsToJsonSchema(declared.action.fields ?? []);
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (!validate(request.params ?? {})) {
    return rejected('schema-invalid', '参数不符合动作字段 schema', validate.errors);
  }
  const candidate = detailFor(
    request,
    declared.threadId,
    receipt(guarded.guards, request.authorization),
  );
  let detail: unknown;
  try {
    detail = parseThreadEventDetail(candidate.kind, candidate.detail);
  } catch (error) {
    return rejected('schema-invalid', '参数不符合 Work Thread 严格合同', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const event: EngineEvent & { kind: ThreadEventKind } = {
    kind: candidate.kind,
    rel: candidate.entityRel,
    action: request.action,
    actor: request.actor ?? 'human',
    principal: request.principal,
    channel: request.channel,
    ...(request.identity === undefined ? {} : { identity: request.identity }),
    detail,
  };
  const next = applyThreadEvent(snapshot, { ...event, seq: 0 });
  return { kind: 'accepted', snapshot: next, event, entityRel: candidate.entityRel };
}
