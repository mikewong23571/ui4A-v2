/** Provider-neutral LLM runtime configuration supplied by deployment state. */
export interface LlmConfigOverrides {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface LlmRuntimeConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

type LlmEnvName = 'LLM_API_KEY' | 'LLM_BASE_URL' | 'LLM_MODEL';

const ENV_NAMES: readonly LlmEnvName[] = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];

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
 * Resolve one complete OpenAI-compatible profile. Explicit overrides exist for
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
