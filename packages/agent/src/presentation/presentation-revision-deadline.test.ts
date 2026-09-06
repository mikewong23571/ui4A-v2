import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  delay: 70_000,
  calls: 0,
  streamText: vi.fn(),
}));
vi.mock('ai', () => ({ streamText: transport.streamText }));

import {
  createPresentationRevisionAgent,
  type PresentationRevisionInput,
} from './presentation-revision';

const input: PresentationRevisionInput = {
  request: {
    sidecarId: 'sidecar:deadline',
    baseVersion: 1,
    messageId: 'message:deadline',
    instruction: 'Make this content more comfortable to read',
  },
  surface: {
    schemaVersion: 1,
    root: {
      kind: 'word',
      id: 'body',
      role: 'primary-content',
      word: 'prose',
      bindings: { value: { kind: 'property', subject: 'record:one', path: 'properties.body' } },
      dependencies: [],
      provenance: [{ kind: 'generic-fallback', ref: 'fixture' }],
    },
  },
  catalog: {
    id: 'catalog',
    version: '1',
    words: {
      prose: {
        roles: ['primary-content'],
        bindings: { value: { sources: ['property'], required: true } },
      },
    },
  },
};
const profile = { apiKey: 'test-only', baseURL: 'https://example.invalid/v1', model: 'test-model' };
const patchText = '{"operations":[{"kind":"density","nodeId":"body","density":"spacious"}]}';

beforeEach(() => {
  vi.useFakeTimers();
  transport.calls = 0;
  transport.streamText.mockReset();
  // Node's native AbortSignal timeout uses an internal timer. Route it through the controlled
  // clock while preserving its real abort event/reason semantics; test the consumed stream,
  // not the timeout argument or a source-code constant.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
  transport.streamText.mockImplementation(
    ({ abortSignal, maxRetries }: { abortSignal: AbortSignal; maxRetries: number }) => {
      transport.calls += 1;
      expect(maxRetries).toBe(0);
      return {
        fullStream: (async function* () {
          const completed = await new Promise<boolean>((resolve) => {
            const abort = () => {
              clearTimeout(timer);
              resolve(false);
            };
            const timer = setTimeout(() => {
              abortSignal.removeEventListener('abort', abort);
              resolve(true);
            }, transport.delay);
            if (abortSignal.aborted) abort();
            else abortSignal.addEventListener('abort', abort, { once: true });
          });
          if (completed) yield { type: 'text-delta', text: patchText };
          else yield { type: 'abort', reason: 'deadline' };
        })(),
      };
    },
  );
});

afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Presentation Revision bounded stream deadline', () => {
  it('accepts a real semantic result arriving after the former 60-second cutoff', async () => {
    transport.delay = 70_000;
    let settled = false;
    const pending = createPresentationRevisionAgent(profile)
      .revise(input)
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(9_999);
    await expect(pending).resolves.toMatchObject({
      status: 'patch',
      patch: {
        sidecarId: input.request.sidecarId,
        operations: [{ kind: 'density', nodeId: 'body', density: 'spacious' }],
      },
    });
    expect(transport.calls).toBe(1);
  });

  it('aborts at the 300-second bound and never returns a late patch or retries', async () => {
    transport.delay = 300_001;
    let settled = false;
    const pending = createPresentationRevisionAgent(profile)
      .revise(input)
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.advanceTimersByTimeAsync(299_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({
      status: 'failed',
      reasonCode: 'transport-failed',
      issues: ['Presentation revision LLM request failed'],
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.calls).toBe(1);
  });

  it('honors an explicitly shorter caller deadline without retry or a patch', async () => {
    transport.delay = 70_000;
    const pending = createPresentationRevisionAgent({ ...profile, timeoutMs: 10 }).revise(input);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      reasonCode: 'transport-failed',
    });
    await vi.advanceTimersByTimeAsync(70_000);
    expect(transport.calls).toBe(1);
  });
});
