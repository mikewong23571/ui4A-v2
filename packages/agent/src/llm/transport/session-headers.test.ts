import { describe, expect, it } from 'vitest';
import { createLlmDriver } from '../llm-driver';
import { resolveLlmConfig } from '../llm-config';

const config = { apiKey: 'secret', baseURL: 'https://provider.test/v1', model: 'test' };
const context = {
  goal: { verb: 'Read current work' },
  currentRel: 'threads',
  entity: { class: ['collection'], properties: { rel: 'threads' }, actions: [], links: [] },
  trail: [],
  successes: [],
};

describe('provider session transport', () => {
  it('sends opaque stable conversation identity across reconstructed drivers', async () => {
    const seen: Headers[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response('{"error":{"message":"test failure"}}', { status: 400 });
    };
    for (const sessionId of [
      'principal-a/session-1',
      'principal-a/session-1',
      'principal-b/session-1',
    ]) {
      await createLlmDriver({
        ...config,
        sessionHeader: 'x-provider-session',
        sessionId,
        fetchImpl,
      }).decide(context);
    }
    expect(seen).toHaveLength(3);
    const first = seen[0]!.get('x-provider-session');
    expect(first).toMatch(/^ui4a-[a-f0-9]{64}$/);
    expect(seen[1]!.get('x-provider-session')).toBe(first);
    expect(seen[2]!.get('x-provider-session')).not.toBe(first);
    expect(seen[0]!.get('user-agent')).toContain('ui4a/');
    expect(seen[0]!.get('authorization')).toBe('Bearer secret');
  });

  it('resolves configured extension header and refuses reserved or malformed names', () => {
    expect(
      resolveLlmConfig(config, { LLM_SESSION_HEADER: 'x-provider-session' }).sessionHeader,
    ).toBe('x-provider-session');
    for (const sessionHeader of ['authorization', 'cookie', 'x-evil\r\nInjected: yes']) {
      expect(() => resolveLlmConfig({ ...config, sessionHeader })).toThrow();
    }
  });
});
