/** Provider-neutral LLM runtime configuration supplied by deployment state. */
export interface LlmConfigOverrides {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /**
   * 发送前 provider request UTF-8 JSON 预算(D54.4 机制;D72 修订为可配置):
   * 缺省时依次取 LLM_PROVIDER_REQUEST_BUDGET_BYTES 环境变量与保守默认值。
   */
  requestBudgetBytes?: number;
}

export interface LlmRuntimeConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  requestBudgetBytes: number;
}

type LlmEnvName = 'LLM_API_KEY' | 'LLM_BASE_URL' | 'LLM_MODEL';

const ENV_NAMES: readonly LlmEnvName[] = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];

const BUDGET_ENV_NAME = 'LLM_PROVIDER_REQUEST_BUDGET_BYTES';

/**
 * 保守的 provider request 预算默认值(D72):仍是防失控的保护门(拒绝式诚实
 * 失败在 fetch 前),但不再贴着真实装配体积——主流 OpenAI 兼容端点的请求体
 * 上限远大于此,D54 实测过的最大真实请求(约 175 KiB)也在余量内。
 */
export const DEFAULT_LLM_PROVIDER_REQUEST_BUDGET_BYTES = 512 * 1024;

/** Configuration failures name missing variables but never include configured values. */
export class LlmConfigurationError extends Error {
  constructor(readonly missing: readonly LlmEnvName[]) {
    super(`LLM 配置缺失: ${missing.join(', ')}`);
    this.name = 'LlmConfigurationError';
  }
}

function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * 预算解析:显式覆盖 > 环境变量 > 默认值。环境变量必须是正整数字节;
 * 缺失或非法值都落到默认值(预算是保护门而非正确性输入,配置笔误不应
 * 拖垮聊天主路径)。
 */
function resolveRequestBudgetBytes(override: number | undefined, env: NodeJS.ProcessEnv): number {
  if (override !== undefined) return override;
  const raw = configured(env[BUDGET_ENV_NAME]);
  if (raw !== undefined && /^[1-9][0-9]*$/.test(raw)) return Number(raw);
  return DEFAULT_LLM_PROVIDER_REQUEST_BUDGET_BYTES;
}

/**
 * Resolve one complete OpenAI-API profile. Explicit overrides exist for
 * protocol tests; production callers use the three generic environment names.
 */
export function resolveLlmConfig(
  overrides: LlmConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): LlmRuntimeConfig {
  const values: Partial<Record<LlmEnvName, string>> = {
    LLM_API_KEY: configured(overrides.apiKey) ?? configured(env.LLM_API_KEY),
    LLM_BASE_URL: configured(overrides.baseURL) ?? configured(env.LLM_BASE_URL),
    LLM_MODEL: configured(overrides.model) ?? configured(env.LLM_MODEL),
  };
  const missing = ENV_NAMES.filter((name) => values[name] === undefined);
  if (missing.length > 0) throw new LlmConfigurationError(missing);
  return {
    apiKey: values.LLM_API_KEY!,
    baseURL: values.LLM_BASE_URL!,
    model: values.LLM_MODEL!,
    requestBudgetBytes: resolveRequestBudgetBytes(overrides.requestBudgetBytes, env),
  };
}

/** True only when the whole runtime profile is available. */
export function hasLlmConfig(overrides: LlmConfigOverrides = {}): boolean {
  try {
    resolveLlmConfig(overrides);
    return true;
  } catch (error) {
    if (error instanceof LlmConfigurationError) return false;
    throw error;
  }
}
