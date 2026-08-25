import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
}));

vi.mock('./production-deployment-preflight', () => ({
  runWebProductionDeploymentPreflight: mocks.preflight,
}));

import { register } from './instrumentation';

// production 启动时把 settings/secrets 文件里的 LLM 合同导出为 LLM_* 进程环境,
// 供 resolveLlmConfig() 统一读取;显式预设的 LLM_* 优先;缺项不得写入
// (process.env 会把 undefined 字符串化)。

const CONFIG = {
  settings: {
    llm: {
      baseUrl: 'https://llm.ui4a.internal/v1',
      model: 'test-model',
      apiKeyRef: 'llm-api-key',
      requestTimeoutMs: 60_000,
    },
  },
  secrets: { 'llm-api-key': 'secret-key-from-file' },
};

const LLM_KEYS = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const;

let originalEnvironment: Partial<Record<(typeof LLM_KEYS)[number], string>>;

beforeEach(() => {
  originalEnvironment = Object.fromEntries(
    LLM_KEYS.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  );
  for (const key of LLM_KEYS) delete process.env[key];
  mocks.preflight.mockReset();
});

afterEach(() => {
  for (const key of LLM_KEYS) {
    const original = originalEnvironment[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

describe('instrumentation LLM env export', () => {
  it('exports LLM_* from the production deployment contract', async () => {
    mocks.preflight.mockReturnValue(CONFIG);

    await register();

    expect(process.env.LLM_BASE_URL).toBe('https://llm.ui4a.internal/v1');
    expect(process.env.LLM_MODEL).toBe('test-model');
    expect(process.env.LLM_API_KEY).toBe('secret-key-from-file');
  });

  it('keeps explicitly preset LLM_* values', async () => {
    process.env.LLM_API_KEY = 'explicit-key';
    process.env.LLM_BASE_URL = 'https://llm.example.internal/v1';
    process.env.LLM_MODEL = 'explicit-model';
    mocks.preflight.mockReturnValue(CONFIG);

    await register();

    expect(process.env.LLM_API_KEY).toBe('explicit-key');
    expect(process.env.LLM_BASE_URL).toBe('https://llm.example.internal/v1');
    expect(process.env.LLM_MODEL).toBe('explicit-model');
  });

  it('writes nothing when the apiKeyRef secret is absent', async () => {
    mocks.preflight.mockReturnValue({ settings: CONFIG.settings, secrets: {} });

    await register();

    expect(process.env.LLM_API_KEY).toBeUndefined();
    expect(process.env.LLM_BASE_URL).toBe('https://llm.ui4a.internal/v1');
    expect(process.env.LLM_MODEL).toBe('test-model');
  });

  it('exports nothing when preflight finds no production config', async () => {
    mocks.preflight.mockReturnValue(undefined);

    await register();

    for (const key of LLM_KEYS) expect(process.env[key]).toBeUndefined();
  });
});
