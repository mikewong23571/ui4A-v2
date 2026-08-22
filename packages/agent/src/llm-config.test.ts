import { afterEach, describe, expect, it } from 'vitest';

import { LlmConfigurationError, resolveLlmConfig } from './llm-config';

const ORIGINAL_ENV = {
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL,
};

function restore(name: keyof typeof ORIGINAL_ENV): void {
  const value = ORIGINAL_ENV[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('LLM_API_KEY');
  restore('LLM_BASE_URL');
  restore('LLM_MODEL');
});

describe('resolveLlmConfig(provider-neutral runtime contract)', () => {
  it('reads the complete profile from generic environment variables', () => {
    process.env.LLM_API_KEY = 'test-secret';
    process.env.LLM_BASE_URL = 'https://provider.example/v1';
    process.env.LLM_MODEL = 'model-a';

    expect(resolveLlmConfig()).toEqual({
      apiKey: 'test-secret',
      baseURL: 'https://provider.example/v1',
      model: 'model-a',
    });
  });

  it('has no built-in provider/model/key defaults and reports every missing variable', () => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;

    expect(() => resolveLlmConfig()).toThrow(LlmConfigurationError);
    expect(() => resolveLlmConfig()).toThrow('LLM_API_KEY, LLM_BASE_URL, LLM_MODEL');
  });

  it('treats blank values as missing without exposing another configured value', () => {
    process.env.LLM_API_KEY = 'never-print-this';
    process.env.LLM_BASE_URL = '   ';
    process.env.LLM_MODEL = 'model-a';

    try {
      resolveLlmConfig();
      expect.fail('blank base URL must fail');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmConfigurationError);
      expect(String(error)).toContain('LLM_BASE_URL');
      expect(String(error)).not.toContain('never-print-this');
    }
  });

  it('supports explicit injected overrides for protocol tests', () => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;

    expect(
      resolveLlmConfig({
        apiKey: 'fixture-key',
        baseURL: 'http://127.0.0.1:9999/v1',
        model: 'fixture-model',
      }),
    ).toEqual({
      apiKey: 'fixture-key',
      baseURL: 'http://127.0.0.1:9999/v1',
      model: 'fixture-model',
    });
  });
});
