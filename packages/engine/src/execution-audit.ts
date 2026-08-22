/**
 * 事件日志的纯审计投影。
 *
 * 该模块不让审计数据参与业务 fold，也不让 LLM 文本成为事实。执行解释仅由
 * 原始消息、引擎裁决留痕、确认决定和 action 事件组成；同一日志以任意输入
 * 顺序重放都得到相同结果。
 */
import type { GuardEvaluation } from '@ui4a/shared';

import type { LogEvent } from './fold';

export interface ExecutionJudgmentDetail {
  authorization?: { sourceMessageId: string; quote: string };
  declaration: { passed: true };
  guards: GuardEvaluation[];
  schema: { passed: true };
  confirmation: {
    required: boolean;
    status: 'not-required' | 'pending';
    policy?: string;
    reason?: string;
  };
}

export interface AuditedAuthorization {
  sourceMessageId: string;
  quote: string;
  status: 'verified' | 'invalid-reference';
  userContent?: string;
}

export interface ExecutionAuditRecord {
  rel: string;
  action: string;
  actor: 'human' | 'agent' | null;
  principal?: string;
  authorization: AuditedAuthorization | null;
  judgment: Omit<ExecutionJudgmentDetail, 'authorization' | 'confirmation'>;
  confirmation:
    | {
        required: false;
        status: 'not-required';
        policy?: string;
        reason?: string;
      }
    | {
        required: true;
        status: 'pending' | 'approved' | 'rejected';
        policy?: string;
        reason?: string;
        requestedEventSeq: number;
        decisionEventSeq?: number;
        executedEventSeq?: number;
        decidedBy?: { actor: 'human' | 'agent'; principal?: string };
      };
  eventSeqs: number[];
  integrity: 'complete' | 'authorization-error';
}

export type AuditProvenanceRecord =
  | { seq: number; kind: 'user-statement'; messageId: string; content: string }
  | {
      seq: number;
      kind: 'parsed-intent';
      sourceMessageIds: string[];
      patch: unknown;
    }
  | {
      seq: number;
      kind: 'llm-inference';
      messageId: string;
      content: string;
      model?: string;
    }
  | {
      seq: number;
      kind: 'contract-fact-reference';
      messageId: string;
      references: { rel: string; pointer: string }[];
    }
  | { seq: number; kind: 'capability-artifact'; rel: string; detail: unknown }
  | { seq: number; kind: 'action-effect'; rel: string; action: string; detail: unknown }
  | { seq: number; kind: 'human-decision'; rel: string; action: string; detail: unknown };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function executionDetail(event: LogEvent): ExecutionJudgmentDetail | undefined {
  const detail = record(event.detail);
  const execution = record(detail?.execution);
  const declaration = record(execution?.declaration);
  const schema = record(execution?.schema);
  const confirmation = record(execution?.confirmation);
  if (
    declaration?.passed !== true ||
    schema?.passed !== true ||
    !Array.isArray(execution?.guards) ||
    typeof confirmation?.required !== 'boolean' ||
    (confirmation.status !== 'not-required' && confirmation.status !== 'pending')
  ) {
    return undefined;
  }
  return execution as unknown as ExecutionJudgmentDetail;
}

function messageKey(principal: string | undefined, messageId: string): string {
  return `${principal ?? ''}\u0000${messageId}`;
}

function userMessages(events: readonly LogEvent[]): Map<string, { seq: number; content: string }> {
  const messages = new Map<string, { seq: number; content: string }>();
  for (const event of events) {
    if (event.kind !== 'chat-message-appended') continue;
    const detail = record(event.detail);
    if (
      detail?.role === 'user' &&
      typeof detail.messageId === 'string' &&
      typeof detail.content === 'string'
    ) {
      messages.set(messageKey(event.principal, detail.messageId), {
        seq: event.seq,
        content: detail.content,
      });
    }
  }
  return messages;
}

function auditAuthorization(
  evidence: ExecutionJudgmentDetail['authorization'],
  eventSeq: number,
  principal: string | undefined,
  messages: ReadonlyMap<string, { seq: number; content: string }>,
): AuditedAuthorization | null {
  if (evidence === undefined) return null;
  const source = messages.get(messageKey(principal, evidence.sourceMessageId));
  const verified =
    source !== undefined && source.seq < eventSeq && source.content.includes(evidence.quote);
  return {
    ...evidence,
    status: verified ? 'verified' : 'invalid-reference',
    ...(source !== undefined ? { userContent: source.content } : {}),
  };
}

function baseJudgment(
  detail: ExecutionJudgmentDetail | undefined,
): ExecutionAuditRecord['judgment'] {
  return detail === undefined
    ? { declaration: { passed: true }, guards: [], schema: { passed: true } }
    : {
        declaration: detail.declaration,
        guards: detail.guards.map((guard) => ({ ...guard })),
        schema: detail.schema,
      };
}

function confirmationId(event: LogEvent): string | undefined {
  const detail = record(event.detail);
  return typeof detail?.id === 'string' ? detail.id : undefined;
}

/** 执行级解释材料；旧日志缺裁决细节时保留事件事实，但绝不补造授权。 */
export function projectExecutionAudit(events: readonly LogEvent[]): ExecutionAuditRecord[] {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const messages = userMessages(ordered);
  const consumedActionSeqs = new Set<number>();
  const records: ExecutionAuditRecord[] = [];

  for (const requested of ordered.filter((event) => event.kind === 'confirmation-requested')) {
    const detail = record(requested.detail);
    const request = record(detail?.request);
    const execution = executionDetail(requested);
    if (typeof detail?.targetRel !== 'string' || typeof detail.targetAction !== 'string') continue;

    const id = typeof detail.id === 'string' ? detail.id : undefined;
    const decision =
      id === undefined
        ? undefined
        : ordered.find(
            (event) =>
              event.seq > requested.seq &&
              (event.kind === 'confirmation-approved' || event.kind === 'confirmation-rejected') &&
              confirmationId(event) === id,
          );
    const executed =
      decision?.kind !== 'confirmation-approved'
        ? undefined
        : ordered.find(
            (event) =>
              event.seq > decision.seq &&
              event.kind === 'action-executed' &&
              event.rel === detail.targetRel &&
              event.action === detail.targetAction &&
              event.channel === 'confirmation',
          );
    if (executed !== undefined) consumedActionSeqs.add(executed.seq);

    const evidence =
      execution?.authorization ??
      (record(request?.authorization) as ExecutionJudgmentDetail['authorization']);
    const authorization = auditAuthorization(
      evidence,
      requested.seq,
      requested.principal,
      messages,
    );
    const decisionDetail = record(decision?.detail);
    const decidedBy = record(decisionDetail?.decidedBy);
    const status =
      decision?.kind === 'confirmation-approved'
        ? 'approved'
        : decision?.kind === 'confirmation-rejected'
          ? 'rejected'
          : 'pending';
    const eventSeqs = [requested.seq, decision?.seq, executed?.seq].filter(
      (seq): seq is number => seq !== undefined,
    );
    records.push({
      rel: detail.targetRel,
      action: detail.targetAction,
      actor: requested.actor ?? null,
      ...(requested.principal !== undefined ? { principal: requested.principal } : {}),
      authorization,
      judgment: baseJudgment(execution),
      confirmation: {
        required: true,
        status,
        ...(typeof detail.policy === 'string' ? { policy: detail.policy } : {}),
        ...(typeof detail.policyReason === 'string' ? { reason: detail.policyReason } : {}),
        requestedEventSeq: requested.seq,
        ...(decision !== undefined ? { decisionEventSeq: decision.seq } : {}),
        ...(executed !== undefined ? { executedEventSeq: executed.seq } : {}),
        ...(decidedBy?.actor === 'human' || decidedBy?.actor === 'agent'
          ? {
              decidedBy: {
                actor: decidedBy.actor,
                ...(typeof decidedBy.principal === 'string'
                  ? { principal: decidedBy.principal }
                  : {}),
              },
            }
          : {}),
      },
      eventSeqs,
      integrity:
        requested.actor === 'agent' && authorization?.status !== 'verified'
          ? 'authorization-error'
          : 'complete',
    });
  }

  for (const event of ordered) {
    if (event.kind !== 'action-executed' || consumedActionSeqs.has(event.seq)) continue;
    const execution = executionDetail(event);
    const authorization = auditAuthorization(
      execution?.authorization,
      event.seq,
      event.principal,
      messages,
    );
    records.push({
      rel: event.rel ?? '',
      action: event.action ?? '',
      actor: event.actor ?? null,
      ...(event.principal !== undefined ? { principal: event.principal } : {}),
      authorization,
      judgment: baseJudgment(execution),
      confirmation: {
        required: false,
        status: 'not-required',
        ...(execution?.confirmation.policy !== undefined
          ? { policy: execution.confirmation.policy }
          : {}),
        ...(execution?.confirmation.reason !== undefined
          ? { reason: execution.confirmation.reason }
          : {}),
      },
      eventSeqs: [event.seq],
      integrity:
        event.actor === 'agent' && authorization?.status !== 'verified'
          ? 'authorization-error'
          : 'complete',
    });
  }

  return records.sort((left, right) => left.eventSeqs[0]! - right.eventSeqs[0]!);
}

function citations(value: unknown): { rel: string; pointer: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const item = record(candidate);
    return typeof item?.rel === 'string' && typeof item.pointer === 'string'
      ? [{ rel: item.rel, pointer: item.pointer }]
      : [];
  });
}

/** U21 类型级审计视图；内容类别互斥，模型输出不会混入合同事实记录。 */
export function projectAuditProvenance(events: readonly LogEvent[]): AuditProvenanceRecord[] {
  const output: AuditProvenanceRecord[] = [];
  for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
    const detail = record(event.detail);
    if (event.kind === 'chat-message-appended') {
      if (typeof detail?.messageId !== 'string' || typeof detail.content !== 'string') continue;
      if (detail.role === 'user') {
        output.push({
          seq: event.seq,
          kind: 'user-statement',
          messageId: detail.messageId,
          content: detail.content,
        });
      } else if (detail.role === 'assistant') {
        const provenance = record(detail.provenance);
        output.push({
          seq: event.seq,
          kind: 'llm-inference',
          messageId: detail.messageId,
          content: detail.content,
          ...(typeof provenance?.model === 'string' ? { model: provenance.model } : {}),
        });
        const references = citations(detail.citations);
        if (references.length > 0) {
          output.push({
            seq: event.seq,
            kind: 'contract-fact-reference',
            messageId: detail.messageId,
            references,
          });
        }
      }
      continue;
    }
    if (event.kind === 'chat-context-updated') {
      const provenance = record(detail?.provenance);
      output.push({
        seq: event.seq,
        kind: 'parsed-intent',
        sourceMessageIds: Array.isArray(provenance?.sourceMessageIds)
          ? provenance.sourceMessageIds.filter(
              (messageId): messageId is string => typeof messageId === 'string',
            )
          : [],
        patch: detail?.patch,
      });
      continue;
    }
    if (event.kind === 'capability-artifact-created') {
      output.push({ seq: event.seq, kind: 'capability-artifact', rel: event.rel ?? '', detail });
      continue;
    }
    if (event.kind === 'action-executed') {
      output.push({
        seq: event.seq,
        kind: 'action-effect',
        rel: event.rel ?? '',
        action: event.action ?? '',
        detail,
      });
      continue;
    }
    if (
      event.actor === 'human' &&
      (event.kind === 'confirmation-approved' || event.kind === 'confirmation-rejected')
    ) {
      output.push({
        seq: event.seq,
        kind: 'human-decision',
        rel: event.rel ?? '',
        action: event.action ?? '',
        detail,
      });
    }
  }
  return output;
}
