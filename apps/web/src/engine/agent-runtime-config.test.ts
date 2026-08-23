import { describe, expect, it } from 'vitest';

import type { CodingExecutorProfile } from '@ui4a/shared';

import { codingProfileAsAgentRuntime } from './agent-runtime-config';

const profile: CodingExecutorProfile = {
  name: 'default',
  executorClass: 'coding-agent',
  providerId: 'codex',
  transport: 'sdk',
  workspaceBackend: 'isolated-worktree',
  sandbox: 'workspace-write',
  timeoutSeconds: 300,
  maxTurns: 20,
  envAllowlist: ['PATH'],
  networkPolicy: 'none',
};

describe('T18 Coding profile compatibility adapter', () => {
  it('projects a provider-neutral exact Agent Runtime profile without credentials', () => {
    expect(codingProfileAsAgentRuntime(profile)).toEqual({
      ref: 'default',
      version: 1,
      runtimeClass: 'coding-agent',
      features: ['resume', 'structured-events', 'workspace-write'],
      tools: ['filesystem', 'git', 'shell'],
      resourceBackends: ['repository'],
      providerAdapterRef: 'coding-executor:codex:sdk@1',
      available: true,
    });
  });
});
