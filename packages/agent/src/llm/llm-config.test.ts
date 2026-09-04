import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_LLM_PROVIDER_REQUEST_BUDGET_BYTES,
  LlmConfigurationError,
  resolveLlmConfig,
} from './llm-config';

const ORIGINAL_ENV = {
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_PROVIDER_REQUEST_BUDGET_BYTES: process.env.LLM_PROVIDER_REQUEST_BUDGET_BYTES,
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
  restore('LLM_PROVIDER_REQUEST_BUDGET_BYTES');
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
      requestBudgetBytes: DEFAULT_LLM_PROVIDER_REQUEST_BUDGET_BYTES,
    });
  });

  it('defaults the provider request budget to the conservative built-in value', () => {
    process.env.LLM_API_KEY = 'test-secret';
    process.env.LLM_BASE_URL = 'https://provider.example/v1';
    process.env.LLM_MODEL = 'model-a';
    delete process.env.LLM_PROVIDER_REQUEST_BUDGET_BYTES;

    expect(resolveLlmConfig().requestBudgetBytes).toBe(512 * 1024);
  });

  it('reads a positive-integer budget override from the environment', () => {
    process.env.LLM_API_KEY = 'test-secret';
    process.env.LLM_BASE_URL = 'https://provider.example/v1';
    process.env.LLM_MODEL = 'model-a';
    process.env.LLM_PROVIDER_REQUEST_BUDGET_BYTES = '65536';

    expect(resolveLlmConfig().requestBudgetBytes).toBe(65_536);
  });

  it('falls back to the default budget when the environment value is not a positive integer', () => {
    process.env.LLM_API_KEY = 'test-secret';
    process.env.LLM_BASE_URL = 'https://provider.example/v1';
    process.env.LLM_MODEL = 'model-a';
    for (const invalid of ['abc', '0', '-4096', '32.5']) {
      process.env.LLM_PROVIDER_REQUEST_BUDGET_BYTES = invalid;
      expect(resolveLlmConfig().requestBudgetBytes).toBe(DEFAULT_LLM_PROVIDER_REQUEST_BUDGET_BYTES);
    }
  });

  it('prefers the explicit budget override over the environment value', () => {
    process.env.LLM_API_KEY = 'test-secret';
    process.env.LLM_BASE_URL = 'https://provider.example/v1';
    process.env.LLM_MODEL = 'model-a';
    process.env.LLM_PROVIDER_REQUEST_BUDGET_BYTES = '65536';

    expect(resolveLlmConfig({ requestBudgetBytes: 4096 }).requestBudgetBytes).toBe(4096);
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
      requestBudgetBytes: DEFAULT_LLM_PROVIDER_REQUEST_BUDGET_BYTES,
    });
  });
});
