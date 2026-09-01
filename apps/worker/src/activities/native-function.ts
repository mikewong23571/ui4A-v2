import { activityInfo, Context } from '@temporalio/activity';

import type { NativeFunctionOutcomeV1, NativeFunctionWorkflowInputV1 } from '@ui4a/shared';
import { hashCanonicalAgentJson } from '@ui4a/engine';

import {
  createNativeFunctionHandlerRegistry,
  executeNativeFunction,
} from '../capabilities/function/adapter';

export interface NativeFunctionFinalizeInput {
  context: NativeFunctionWorkflowInputV1;
  outcome: NativeFunctionOutcomeV1;
}

export interface NativeFunctionActivities {
  executeNativeFunctionActivity(
    input: NativeFunctionWorkflowInputV1,
  ): Promise<NativeFunctionOutcomeV1>;
  finalizeNativeFunctionActivity(input: NativeFunctionFinalizeInput): Promise<void>;
}

const registry = createNativeFunctionHandlerRegistry([]);

export async function executeNativeFunctionActivity(
  input: NativeFunctionWorkflowInputV1,
): Promise<NativeFunctionOutcomeV1> {
  return executeNativeFunction(input, {
    registry,
    signal: Context.current().cancellationSignal,
    attempt: activityInfo().attempt,
  });
}

export async function finalizeNativeFunctionActivity(
  input: NativeFunctionFinalizeInput,
): Promise<void> {
  const baseUrl = process.env.UI4A_PUBLIC_BASE_URL;
  const token = process.env.UI4A_CAPABILITY_CALLBACK_TOKEN;
  if (baseUrl === undefined || baseUrl === '' || token === undefined || token === '') {
    throw new Error('native function callback deployment is not configured');
  }
  const response = await fetch(`${baseUrl}/api/internal/function-callback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ui4a-capability-token': token,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      executionId: input.context.executionId,
      sourceEventId: input.context.invocation.source.eventId,
      invocationHash: hashCanonicalAgentJson(input.context.invocation as never),
      outcome: input.outcome,
    }),
  });
  if (!response.ok) {
    throw new Error(`native function callback failed (${response.status})`);
  }
}
