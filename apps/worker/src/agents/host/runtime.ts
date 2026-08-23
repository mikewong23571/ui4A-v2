import { activityInfo, cancellationSignal, heartbeat } from '@temporalio/activity';

import type {
  AgentExecuteActivityArgs,
  AgentExecutionHeartbeat,
  AgentExecutionResult,
  AgentRestartCommandPort,
  AgentRuntimePort,
  AgentRuntimeProgress,
} from './contracts';

/** Injectable Temporal controls keep adapter logic deterministic under unit tests. */
export interface AgentActivityControls {
  attempt: number;
  heartbeatDetails?: unknown;
  signal: AbortSignal;
  heartbeat(details: AgentExecutionHeartbeat): void;
}

export interface AgentRuntimeStepPorts {
  runtime: AgentRuntimePort;
  recordRestart: AgentRestartCommandPort['recordRestart'];
}

function temporalControls(): AgentActivityControls {
  const info = activityInfo();
  return {
    attempt: info.attempt,
    heartbeatDetails: info.heartbeatDetails,
    signal: cancellationSignal(),
    heartbeat,
  };
}

function checkpointForRun(runId: string, value: unknown): AgentExecutionHeartbeat | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('agent runtime heartbeat checkpoint is malformed');
  }
  const checkpoint = value as Partial<AgentExecutionHeartbeat>;
  if (checkpoint.schemaVersion !== 1 || typeof checkpoint.runId !== 'string') {
    throw new Error('agent runtime heartbeat checkpoint is malformed');
  }
  if (checkpoint.runId !== runId) {
    throw new Error(`heartbeat checkpoint does not belong to ${runId}`);
  }
  if (checkpoint.cursor !== null && typeof checkpoint.cursor !== 'string') {
    throw new Error('agent runtime heartbeat cursor is malformed');
  }
  if (!('state' in checkpoint)) throw new Error('agent runtime heartbeat state is missing');
  return checkpoint as AgentExecutionHeartbeat;
}

/**
 * Execute one generic Runtime activity attempt.
 *
 * Temporal heartbeat data is the native retry cursor. A retry calls the Runtime's resume port when
 * available; otherwise the Host records an explicit restart boundary before re-observing the same
 * prepared state. The immutable Workflow context is forwarded verbatim on every attempt.
 */
export async function executeAgentRuntimeStep(
  args: AgentExecuteActivityArgs,
  ports: AgentRuntimeStepPorts,
  controls: AgentActivityControls = temporalControls(),
): Promise<AgentExecutionResult> {
  const checkpoint = checkpointForRun(args.context.runId, controls.heartbeatDetails);
  const reportProgress = (progress: AgentRuntimeProgress): void => {
    controls.heartbeat({
      schemaVersion: 1,
      runId: args.context.runId,
      cursor: progress.cursor,
      state: progress.state,
    });
  };

  const baseInput = {
    ...args,
    signal: controls.signal,
    reportProgress,
  };
  if (controls.attempt > 1 && checkpoint !== undefined && ports.runtime.resume !== undefined) {
    await ports.recordRestart({
      context: args.context,
      attempt: controls.attempt,
      priorCursor: checkpoint.cursor,
      reason: 'activity-retry-native-resume',
    });
    return ports.runtime.resume({ ...baseInput, restartBoundary: false, checkpoint });
  }

  const restartBoundary = controls.attempt > 1;
  if (restartBoundary) {
    await ports.recordRestart({
      context: args.context,
      attempt: controls.attempt,
      priorCursor: checkpoint?.cursor ?? null,
      reason: 'activity-retry-restart-boundary',
    });
  }
  return ports.runtime.execute({ ...baseInput, restartBoundary });
}
