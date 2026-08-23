import type { CodingNormalizedEvent } from '@ui4a/shared';

type NormalizedPayload = CodingNormalizedEvent extends infer Event
  ? Event extends CodingNormalizedEvent
    ? Omit<Event, 'schemaVersion' | 'eventId' | 'runId' | 'sequence'>
    : never
  : never;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize the stable subset of Claude Code stream-json; preserve unknown frames as passthrough. */
export function normalizeClaudeFrame(frame: unknown): NormalizedPayload[] {
  if (!record(frame) || typeof frame.type !== 'string') {
    return [{ kind: 'provider-event', providerDetail: frame }];
  }
  if (frame.type === 'system' && frame.subtype === 'init') {
    return [
      {
        kind: 'run-started',
        ...(typeof frame.session_id === 'string' ? { nativeSessionId: frame.session_id } : {}),
      },
    ];
  }
  if (frame.type === 'result') {
    if (frame.is_error === true) {
      return [
        {
          kind: 'run-failed',
          code:
            typeof frame.terminal_reason === 'string' ? frame.terminal_reason : 'provider-error',
          reason: typeof frame.result === 'string' ? frame.result : 'Claude Code failed',
        },
      ];
    }
    return [
      {
        kind: 'progress-reported',
        message: typeof frame.result === 'string' ? frame.result : 'Claude Code completed',
      },
    ];
  }
  return [{ kind: 'provider-event', providerDetail: { type: frame.type, subtype: frame.subtype } }];
}

/** Normalize Gemini CLI headless JSONL init/tool/result/error events. */
export function normalizeGeminiFrame(frame: unknown): NormalizedPayload[] {
  if (!record(frame) || typeof frame.type !== 'string') {
    return [{ kind: 'provider-event', providerDetail: frame }];
  }
  if (frame.type === 'init') {
    return [
      {
        kind: 'run-started',
        ...(typeof frame.session_id === 'string' ? { nativeSessionId: frame.session_id } : {}),
      },
    ];
  }
  if (frame.type === 'tool_use') {
    return [
      {
        kind: 'command-started',
        commandId: typeof frame.tool_id === 'string' ? frame.tool_id : 'gemini-tool',
        summary: typeof frame.name === 'string' ? frame.name : 'Gemini tool',
      },
    ];
  }
  if (frame.type === 'tool_result') {
    return [
      {
        kind: 'command-completed',
        commandId: typeof frame.tool_id === 'string' ? frame.tool_id : 'gemini-tool',
        exitCode: frame.status === 'error' ? 1 : 0,
      },
    ];
  }
  if (frame.type === 'error') {
    return [
      {
        kind: 'run-failed',
        code: 'provider-error',
        reason: typeof frame.message === 'string' ? frame.message : 'Gemini CLI failed',
      },
    ];
  }
  return [{ kind: 'provider-event', providerDetail: { type: frame.type } }];
}
