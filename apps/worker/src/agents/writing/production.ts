import { isAbsolute, join, relative, resolve } from 'node:path';

import type { ProductionDeploymentConfig } from '@ui4a/shared';

import type { DocumentAgentProfile } from './adapter';

const PRODUCTION_WRITING_MAX_TURNS = 16;

function productionProfile(config: ProductionDeploymentConfig) {
  const id = config.settings.runtime.defaultProfiles.writing;
  const matches = config.settings.runtime.profiles.filter(
    (profile) => profile.id === id && profile.specialization === 'writing',
  );
  if (matches.length !== 1) throw new Error('production_writing_profile_invalid');
  return matches[0]!;
}

function assertWorkspaceBase(value: string): string {
  if (!isAbsolute(value)) throw new Error('production_writing_profile_invalid');
  const normalized = resolve(value);
  if (normalized === resolve('/')) throw new Error('production_writing_profile_invalid');
  return normalized;
}

/** Compose the remote Writing adapter from one canonical, server-owned production default. */
export function composeProductionWritingAgent(config: ProductionDeploymentConfig): {
  workspaceRoot: string;
  workspaceRootForRun(runId: string): string;
  profiles: [DocumentAgentProfile];
  probe(): Promise<{ available: true }>;
} {
  const selected = productionProfile(config);
  const workspaceRoot = assertWorkspaceBase(selected.workspaceRoot);
  const profile: DocumentAgentProfile = {
    name: selected.id,
    runtimeClass: 'document-agent',
    providerId: 'codex',
    transport: 'sdk',
    model: config.settings.llm.model,
    endpoint: config.settings.llm.baseUrl,
    apiKeyEnv: config.settings.llm.apiKeyRef,
    artifactBackend: 'isolated-document-workspace',
    timeoutSeconds: selected.timeoutSeconds,
    maxTurns: PRODUCTION_WRITING_MAX_TURNS,
    envAllowlist: [],
    networkPolicy: 'none',
  };
  return {
    workspaceRoot,
    workspaceRootForRun(runId) {
      if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(runId) || runId.includes('..')) {
        throw new Error('production_writing_run_invalid');
      }
      const candidate = resolve(join(workspaceRoot, runId, 'agent'));
      const child = relative(workspaceRoot, candidate);
      if (child === '' || child.startsWith('..') || isAbsolute(child)) {
        throw new Error('production_writing_run_invalid');
      }
      return candidate;
    },
    profiles: [profile],
    async probe() {
      // Provider availability is owned by the selected one-shot Runner, never the Worker process.
      return { available: true };
    },
  };
}
