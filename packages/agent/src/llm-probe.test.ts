import { afterEach, describe, expect, it, vi } from 'vitest';

import { LlmConfigurationError } from './llm-config';
import { formatProbeReport, runGenerateProbe, type GlmProbeObservation } from './llm-probe';

function completion(model: string): Response {
  return Response.json({
    id: 'chatcmpl-probe-test',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'done', arguments: '{"summary":"ok"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function observation(overrides: Partial<GlmProbeObservation> = {}): GlmProbeObservation {
  return {
    mode: 'generateText',
    model: 'fixture-model',
    baseURL: 'https://provider.example/v1',
    latencyMs: 1,
    error: null,
    sdkReasoningPartCount: 0,
    sdkReasoningText: null,
    rawMessageKeys: [],
    rawReasoningText: null,
    toolCalls: [{ name: 'done', input: { summary: 'ok' } }],
    finishReason: 'tool-calls',
    usage: null,
    streamPartCounts: {},
    firstPartAtMs: null,
    firstReasoningAtMs: null,
    lastReasoningAtMs: null,
    reasoningChunkCount: 0,
    firstContentAtMs: null,
    firstToolCallsAtMs: null,
    rawChunkCount: 0,
    textPreview: '',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('provider-neutral LLM probe configuration', () => {
  it('uses the complete generic environment profile for the request', async () => {
    vi.stubEnv('LLM_API_KEY', 'fixture-key');
    vi.stubEnv('LLM_BASE_URL', 'https://provider.example/v1');
    vi.stubEnv('LLM_MODEL', 'fixture-model');
    vi.stubEnv('GLM_API_KEY', 'unused-key-must-not-be-used');

    const calls: Array<{ url: string; authorization: string | null; model: unknown }> = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model?: unknown };
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
        model: body.model,
      });
      return completion('fixture-model');
    });

    const result = await runGenerateProbe({ abortMs: 1_000 });

    expect(result.error).toBeNull();
    expect(result.model).toBe('fixture-model');
    expect(result.baseURL).toBe('https://provider.example/v1');
    expect(calls).toEqual([
      {
        url: 'https://provider.example/v1/chat/completions',
        authorization: 'Bearer fixture-key',
        model: 'fixture-model',
      },
    ]);
  });

  it('rejects an incomplete generic profile before attempting transport', async () => {
    vi.stubEnv('LLM_API_KEY', '');
    vi.stubEnv('LLM_BASE_URL', '');
    vi.stubEnv('LLM_MODEL', '');
    vi.stubEnv('GLM_API_KEY', 'unused-key-must-not-be-used');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(runGenerateProbe()).rejects.toBeInstanceOf(LlmConfigurationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('formats the endpoint captured by the observation without runtime defaults', () => {
    vi.stubEnv('LLM_BASE_URL', 'https://wrong.example/v1');

    const report = formatProbeReport([observation()]);

    expect(report).toContain('模型: fixture-model');
    expect(report).toContain('端点: https://provider.example/v1');
    expect(report).not.toContain('https://wrong.example/v1');
  });
});
