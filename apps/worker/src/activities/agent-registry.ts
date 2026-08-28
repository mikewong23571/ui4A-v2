/** Specialization 注册表与 Agent Run 命令 activities(suspension/resolution 落事件)。 */
import type { ProductionDeploymentConfig } from '@ui4a/shared';

import { appendAgentRunCommand, getAgentRun } from '@ui4a/db/agent-runs';

import type {
  AgentResolutionRecord,
  AgentRunWorkflowArgs,
  AgentSuspensionRecord,
} from '../agents/host/contracts';
import type { ProductionRuntimeSpecializationPort } from '../runtime-backends/production-wiring';
import { workerDb } from '../worker-db';
import { authoringBinding, authoringProductionPort } from './agent-authoring';
import { codingBinding, codingProductionPort } from './agent-coding';
import {
  agentTaskKind,
  type AgentSpecializationAdapter,
  type AgentSpecializationBinding,
} from './agent-shared';
import { writingBinding, writingProductionPort } from './agent-writing';

/** Composition registry: adding a specialization contributes one adapter object, not Host branches. */
const agentSpecializationBindings: readonly AgentSpecializationBinding[] = [
  codingBinding,
  writingBinding,
  authoringBinding,
];

export function runtimeSpecializationPorts(
  config: ProductionDeploymentConfig,
): Record<AgentSpecializationAdapter, ProductionRuntimeSpecializationPort> {
  return {
    coding: codingProductionPort(),
    writing: writingProductionPort(config),
    authoring: authoringProductionPort(),
  };
}

export function specializationBindingForTask(
  context: AgentRunWorkflowArgs,
): AgentSpecializationBinding {
  const kind = agentTaskKind(context);
  const matches = agentSpecializationBindings.filter((binding) => binding.taskKind === kind);
  if (matches.length !== 1) {
    throw new Error(`no Agent specialization adapter is registered for ${kind ?? 'unknown task'}`);
  }
  return matches[0]!;
}

/** Select only the birth-compiled task kind; Provider/profile fields are never task-controlled. */
export function specializationAdapterForTask(
  context: AgentRunWorkflowArgs,
): AgentSpecializationAdapter {
  return specializationBindingForTask(context).name;
}

async function currentNativeRun(context: AgentRunWorkflowArgs) {
  const run = await getAgentRun(workerDb(), context.runId, context.principal, context.policyScope);
  if (run === undefined) throw new Error('native agent run does not exist or is not authorized');
  return run;
}

export async function recordAgentRunSuspension(
  input: AgentSuspensionRecord,
): Promise<{ deduplicated: boolean }> {
  specializationAdapterForTask(input.context);
  const run = await currentNativeRun(input.context);
  const applied = await appendAgentRunCommand(
    workerDb(),
    input.suspension.status === 'needs-input'
      ? {
          kind: 'ask-question',
          runId: input.context.runId,
          expectedRevision: run.revision,
          commandId: input.idempotencyKey,
          eventId: `event:${input.idempotencyKey}`,
          question: input.suspension.question,
        }
      : {
          kind: 'request-resource-grant',
          runId: input.context.runId,
          expectedRevision: run.revision,
          commandId: input.idempotencyKey,
          eventId: `event:${input.idempotencyKey}`,
          request: input.suspension.request,
        },
  );
  return { deduplicated: applied.event === undefined };
}

export async function recordAgentRunResolution(
  input: AgentResolutionRecord,
): Promise<{ deduplicated: boolean }> {
  specializationAdapterForTask(input.context);
  const run = await currentNativeRun(input.context);
  const applied = await appendAgentRunCommand(
    workerDb(),
    input.resolution.kind === 'question-answer'
      ? {
          kind: 'answer-question',
          runId: input.context.runId,
          expectedRevision: run.revision,
          commandId: input.idempotencyKey,
          eventId: `event:${input.idempotencyKey}`,
          questionId: input.resolution.questionId,
          answeredBy: input.resolution.answeredBy,
          answer: input.resolution.answer,
        }
      : {
          kind: 'decide-resource-grant',
          runId: input.context.runId,
          expectedRevision: run.revision,
          commandId: input.idempotencyKey,
          eventId: `event:${input.idempotencyKey}`,
          requestId: input.resolution.requestId,
          decision: input.resolution.decision,
        },
    'human',
  );
  return { deduplicated: applied.event === undefined };
}
