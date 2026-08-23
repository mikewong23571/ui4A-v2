import type { AgentRuntimeProfile } from '@ui4a/engine';
import type { CodingExecutorProfile } from '@ui4a/shared';

/**
 * Adapt the deployed T18 Coding profile into the generic T19 Runtime registry.
 *
 * The legacy profile has no version/features fields, so this compatibility contract fixes version
 * 1 and the features already guaranteed by the T18 Codex/worktree implementation.
 */
export function codingProfileAsAgentRuntime(profile: CodingExecutorProfile): AgentRuntimeProfile {
  return {
    ref: profile.name,
    version: 1,
    runtimeClass: profile.executorClass,
    features: [
      'resume',
      'structured-events',
      profile.sandbox === 'workspace-write' ? 'workspace-write' : 'read-only',
    ],
    tools: ['filesystem', 'git', 'shell'],
    resourceBackends: ['repository'],
    providerAdapterRef: `coding-executor:${profile.providerId}:${profile.transport}@1`,
    available: profile.providerId === 'codex',
    ...(profile.providerId === 'codex'
      ? {}
      : { unavailableReason: `coding executor provider ${profile.providerId} is unavailable` }),
  };
}
