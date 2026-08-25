import type { LlmEvalProfile } from './story-eval-types';

function requiredEnv(name: 'LLM_API_KEY' | 'LLM_BASE_URL' | 'LLM_MODEL'): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    throw new Error(`RUN_LLM_EVAL=1 requires ${name}`);
  }
  return value;
}

export function loadLlmEvalProfile(): LlmEvalProfile {
  return {
    apiKey: requiredEnv('LLM_API_KEY'),
    baseUrl: requiredEnv('LLM_BASE_URL'),
    model: requiredEnv('LLM_MODEL'),
  };
}

export function isolatedEvalDatabaseUrl(): string {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test';
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Story eval refuses non-test database "${databaseName}"`);
  }
  return databaseUrl;
}
