import { describe, expect, it } from 'vitest';
import { parseLlm } from './auth';
describe('LLM routing session declaration', () => {
  it('accepts extension headers and rejects reserved names', () => {
    const llm = {
      baseUrl: 'https://provider.test/v1',
      model: 'test',
      apiKeyRef: 'llm-key',
      requestTimeoutMs: 60000,
    };
    expect(parseLlm({ ...llm, sessionHeader: 'x-provider-session' }).sessionHeader).toBe(
      'x-provider-session',
    );
    expect(() => parseLlm({ ...llm, sessionHeader: 'authorization' })).toThrow();
  });
});
