/**
 * Generic Agent Host specialization 组合契约(T19):
 * 每个 specialization 贡献一个 adapter 对象(binding / production port),
 * 不在 Host 生命周期里散任务类型分支。
 */
import type {
  AgentCollectedResult,
  AgentExecuteActivityArgs,
  AgentExecutionResult,
  AgentFinalizeInput,
  AgentPreparedResult,
  AgentRunWorkflowArgs,
  AgentVerificationResult,
} from '../agents/host/contracts';
import type { collectCodingAgentRunWithDeps, verifyCodingAgentRun } from '../agents/coding';

export type AgentSpecializationAdapter = 'coding' | 'writing' | 'authoring';

export type AgentCollectActivityArgs = Parameters<typeof collectCodingAgentRunWithDeps>[0];
export type AgentVerifyActivityArgs = Parameters<typeof verifyCodingAgentRun>[0];

export interface AgentSpecializationBinding {
  name: AgentSpecializationAdapter;
  taskKind: string;
  prepare(args: AgentRunWorkflowArgs): Promise<AgentPreparedResult>;
  execute(args: AgentExecuteActivityArgs): Promise<AgentExecutionResult>;
  collect(args: AgentCollectActivityArgs): Promise<AgentCollectedResult>;
  verify(args: AgentVerifyActivityArgs): AgentVerificationResult;
  finalize(input: AgentFinalizeInput): Promise<void>;
}

export function agentTaskKind(context: AgentRunWorkflowArgs): string | undefined {
  const payload = context.task.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  return typeof payload.kind === 'string' ? payload.kind : undefined;
}
