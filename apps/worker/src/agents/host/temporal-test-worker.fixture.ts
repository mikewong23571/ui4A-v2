import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { activityInfo } from '@temporalio/activity';
import { NativeConnection, Worker } from '@temporalio/worker';

import type {
  AgentExecuteActivityArgs,
  AgentExecutionHeartbeat,
  AgentExecutionResult,
  AgentFinalizeInput,
  AgentPreparedResult,
  AgentResumeResolution,
  AgentRunActivities,
  AgentRunWorkflowArgs,
  AgentRuntimeExecutionInput,
  AgentRuntimePort,
  AgentRuntimeResumeInput,
} from './contracts';
import { executeAgentRuntimeStep } from './runtime';

const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const taskQueue = process.env.AGENT_HOST_TEST_TASK_QUEUE;
const configuredReceiptPath = process.env.AGENT_HOST_TEST_RECEIPT;
if (taskQueue === undefined || configuredReceiptPath === undefined) {
  throw new Error('AGENT_HOST_TEST_TASK_QUEUE and AGENT_HOST_TEST_RECEIPT are required');
}
const receiptPath = configuredReceiptPath;

async function appendUnique(receipt: string): Promise<void> {
  let existing = '';
  try {
    existing = await readFile(receiptPath, 'utf8');
  } catch {
    // The first receipt creates the file.
  }
  if (existing.split('\n').includes(receipt)) return;
  await appendFile(receiptPath, `${receipt}\n`, 'utf8');
}

function scenario(context: AgentRunWorkflowArgs): string {
  const payload = context.task.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return 'complete';
  return typeof payload.scenario === 'string' ? payload.scenario : 'complete';
}

function checkpoint(
  context: AgentRunWorkflowArgs,
  cursor: string,
  state: AgentExecutionHeartbeat['state'],
): AgentExecutionHeartbeat {
  return { schemaVersion: 1, runId: context.runId, cursor, state };
}

function awaitCancellation(input: AgentRuntimeExecutionInput): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setInterval(
      () => input.reportProgress({ cursor: 'cursor:waiting', state: { waiting: true } }),
      100,
    );
    input.signal.addEventListener(
      'abort',
      () => {
        clearInterval(timer);
        reject(input.signal.reason);
      },
      { once: true },
    );
  });
}

function completed(resolution?: AgentResumeResolution): AgentExecutionResult {
  return {
    status: 'completed',
    state: {
      response: 'fixture completed',
      resolution:
        resolution === undefined
          ? null
          : resolution.kind === 'question-answer'
            ? {
                kind: resolution.kind,
                questionId: resolution.questionId,
                answer: resolution.answer,
                answeredBy: resolution.answeredBy,
              }
            : {
                kind: resolution.kind,
                requestId: resolution.requestId,
                decision: {
                  outcome: resolution.decision.outcome,
                  decidedBy: resolution.decision.decidedBy,
                  grantRef: resolution.decision.grantRef ?? null,
                  reason: resolution.decision.reason ?? null,
                },
              },
    },
  };
}

const runtime: AgentRuntimePort = {
  async execute(input: AgentRuntimeExecutionInput): Promise<AgentExecutionResult> {
    const currentScenario = scenario(input.context);
    input.reportProgress({ cursor: 'cursor:started', state: { scenario: currentScenario } });
    // Let the dev server durably acknowledge the checkpoint before the SIGKILL fixture proceeds.
    if (currentScenario === 'resume-after-kill') {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log(
      `[ui4a-agent-host-test] execute run=${input.context.runId} attempt=${activityInfo().attempt}`,
    );
    if (currentScenario === 'resume-after-kill') return awaitCancellation(input);
    if (currentScenario === 'cancel-me') return awaitCancellation(input);
    if (currentScenario === 'needs-input' && input.resolution === undefined) {
      return {
        status: 'needs-input',
        question: { questionId: 'question:audience', prompt: 'Who is the audience?' },
        checkpoint: checkpoint(input.context, 'cursor:question', { asked: true }),
      };
    }
    if (currentScenario === 'waiting-approval' && input.resolution === undefined) {
      return {
        status: 'waiting-approval',
        request: {
          requestId: 'resource:network-read',
          resource: { kind: 'network', ref: 'source:fixture', operations: ['read'] },
          reason: 'Read a declared fixture source',
        },
        checkpoint: checkpoint(input.context, 'cursor:grant', { requested: true }),
      };
    }
    return completed(input.resolution);
  },
  async resume(input: AgentRuntimeResumeInput): Promise<AgentExecutionResult> {
    console.log(
      `[ui4a-agent-host-test] resume run=${input.context.runId} attempt=${activityInfo().attempt}`,
    );
    input.reportProgress({ cursor: 'cursor:resumed', state: input.checkpoint.state });
    return completed(input.resolution);
  },
};

const activities: AgentRunActivities = {
  async prepareAgentRun(context: AgentRunWorkflowArgs): Promise<AgentPreparedResult> {
    if (scenario(context) === 'prepare-fail') throw new Error('fixture preflight failed');
    return { state: { workspaceRef: `workspace:${context.runId}` } };
  },
  async executeAgentRun(args: AgentExecuteActivityArgs): Promise<AgentExecutionResult> {
    return executeAgentRuntimeStep(args, {
      runtime,
      recordRestart: async (restart) => {
        await appendUnique(`restart:${restart.context.runId}:${restart.attempt}:${restart.reason}`);
      },
    });
  },
  async collectAgentRun(input) {
    return {
      candidate: {
        schemaVersion: 1 as const,
        contract: input.context.birth.resultContract,
        resultId: `result:${input.context.runId}`,
        payload: input.execution.state,
        artifacts: [],
        evidence: [
          {
            ref: `fixture:${input.context.runId}`,
            kind: 'fixture-observation',
            detail: { passed: true },
          },
        ],
        proposedEffects: [],
      },
    };
  },
  async verifyAgentRun(input) {
    return { status: 'succeeded' as const, result: input.collected.candidate };
  },
  async recordAgentRunSuspension(input) {
    const id =
      input.suspension.status === 'needs-input'
        ? input.suspension.question.questionId
        : input.suspension.request.requestId;
    await appendUnique(`suspend:${input.context.runId}:${id}`);
    return { deduplicated: false };
  },
  async recordAgentRunResolution(input) {
    const id =
      input.resolution.kind === 'question-answer'
        ? input.resolution.questionId
        : input.resolution.requestId;
    await appendUnique(`resolve:${input.context.runId}:${id}`);
    return { deduplicated: false };
  },
  async finalizeAgentRun(input: AgentFinalizeInput): Promise<void> {
    await appendUnique(`finalize:${input.context.runId}:${input.outcome.status}`);
  },
};

const connection = await NativeConnection.connect({ address });
const worker = await Worker.create({
  connection,
  namespace: 'default',
  taskQueue,
  workflowsPath: fileURLToPath(new URL('../../workflows.ts', import.meta.url)),
  activities,
});
console.log(`[ui4a-agent-host-test] worker started taskQueue=${taskQueue}`);
process.on('SIGTERM', () => worker.shutdown());
await worker.run();
await connection.close();
