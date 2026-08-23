import { describe, expect, it } from 'vitest';

import { normalizeClaudeFrame, normalizeGeminiFrame } from './compatibility';

describe('provider compatibility fixtures', () => {
  it('does not trust Claude subtype=success when is_error is true', () => {
    expect(
      normalizeClaudeFrame({
        type: 'result',
        subtype: 'success',
        is_error: true,
        terminal_reason: 'api_error',
        result: 'Not logged in',
      }),
    ).toEqual([{ kind: 'run-failed', code: 'api_error', reason: 'Not logged in' }]);
    expect(
      normalizeClaudeFrame({ type: 'system', subtype: 'init', session_id: 'claude-session' }),
    ).toEqual([{ kind: 'run-started', nativeSessionId: 'claude-session' }]);
  });

  it('maps Gemini init/tool/error and preserves unknown provider events', () => {
    expect(normalizeGeminiFrame({ type: 'init', session_id: 'gemini-session' })).toEqual([
      { kind: 'run-started', nativeSessionId: 'gemini-session' },
    ]);
    expect(normalizeGeminiFrame({ type: 'tool_use', tool_id: 't1', name: 'shell' })).toEqual([
      { kind: 'command-started', commandId: 't1', summary: 'shell' },
    ]);
    expect(normalizeGeminiFrame({ type: 'future-event', payload: 1 })).toEqual([
      { kind: 'provider-event', providerDetail: { type: 'future-event' } },
    ]);
  });
});
