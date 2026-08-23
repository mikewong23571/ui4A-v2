import { describe, expect, it } from 'vitest';

import type { CodingExecutorProfile } from '@ui4a/shared';

import {
  codingProfileAsAgentRuntime,
  documentAgentProfileFromEnvironment,
  documentProfileAsAgentRuntime,
} from './agent-runtime-config';

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

describe('document-agent deployment profile', () => {
  it('parses one exact server-owned profile and exposes only a provider-neutral runtime receipt', () => {
    process.env.UI4A_DOCUMENT_AGENT_PROFILES = JSON.stringify([
      {
        name: 'editorial-default',
        runtimeClass: 'document-agent',
        providerId: 'configured-provider',
        transport: 'sdk',
        model: 'configured-model',
        endpoint: 'https://provider.invalid/v1',
        apiKeyEnv: 'WRITING_AGENT_API_KEY',
        artifactBackend: 'isolated-document-workspace',
        timeoutSeconds: 240,
        maxTurns: 16,
        envAllowlist: ['PATH'],
        networkPolicy: 'none',
      },
    ]);

    const deployed = documentAgentProfileFromEnvironment('editorial-default');
    expect(deployed).toMatchObject({
      providerId: 'configured-provider',
      endpoint: 'https://provider.invalid/v1',
      apiKeyEnv: 'WRITING_AGENT_API_KEY',
    });
    expect(documentProfileAsAgentRuntime(deployed)).toEqual({
      ref: 'editorial-default',
      version: 1,
      runtimeClass: 'document-agent',
      features: [
        'structured-result',
        'streamed-events',
        'cancel',
        'resume',
        'document-workspace',
        'artifact-write',
      ],
      tools: ['source-read', 'artifact-write', 'artifact-hash', 'word-count'],
      resourceBackends: ['document-workspace', 'writing-sources'],
      providerAdapterRef: 'document-agent-runtime@1',
      available: true,
    });
  });

  it('fails closed for missing, malformed or mismatched profiles', () => {
    process.env.UI4A_DOCUMENT_AGENT_PROFILES = '[]';
    expect(() => documentAgentProfileFromEnvironment('editorial-default')).toThrow(/profile/i);

    process.env.UI4A_DOCUMENT_AGENT_PROFILES = JSON.stringify([
      { name: 'editorial-default', runtimeClass: 'coding-agent' },
    ]);
    expect(() => documentAgentProfileFromEnvironment('editorial-default')).toThrow(
      /document-agent/i,
    );
  });
});
