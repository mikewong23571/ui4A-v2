import { projectExecutionAudit, type ExecutionAuditRecord, type LogEvent } from '@ui4a/engine';

const DEFAULT_MAX_EXECUTIONS = 8;

/**
 * 给一次 Assistant 回合的有界审计处境。先按 principal 隔离，再裁最近记录；
 * 不做自然语言意图判断，也不让模型补齐缺失证据。
 */
export function executionAuditContext(
  events: readonly LogEvent[],
  principal: string,
  maxExecutions = DEFAULT_MAX_EXECUTIONS,
): ExecutionAuditRecord[] {
  const requested = Number.isFinite(maxExecutions)
    ? Math.max(0, Math.floor(maxExecutions))
    : DEFAULT_MAX_EXECUTIONS;
  if (requested === 0) return [];
  return projectExecutionAudit(events)
    .filter((record) => record.principal === principal)
    .slice(-requested);
}
