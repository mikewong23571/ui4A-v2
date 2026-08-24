import type { AgentRuntimeProfile } from '@ui4a/engine';
import type {
  CodingExecutorProfile,
  ProductionDeploymentConfig,
  ProductionRuntimeProfile,
} from '@ui4a/shared';

export interface DocumentAgentDeploymentProfile {
  name: string;
  runtimeClass: 'document-agent';
  providerId: string;
  transport: 'sdk';
  model: string;
  endpoint?: string;
  apiKeyEnv: string;
  artifactBackend: 'isolated-document-workspace';
  timeoutSeconds: number;
  maxTurns: number;
  envAllowlist: string[];
  networkPolicy: 'none' | 'source-only';
}

export interface AgentAuthoringDeploymentProfile {
  name: string;
  runtimeClass: 'agent-definition-authoring';
  providerId: string;
  transport: 'sdk';
  model: string;
  endpoint?: string;
  apiKeyEnv: string;
  timeoutSeconds: number;
  maxTurns: number;
  envAllowlist: string[];
  networkPolicy: 'none';
}

const PRODUCTION_WRITING_MAX_TURNS = 16;

function exactProductionWritingProfile(
  config: ProductionDeploymentConfig,
): ProductionRuntimeProfile {
  const id = config.settings.runtime.defaultProfiles.writing;
  const matches = config.settings.runtime.profiles.filter(
    (profile) => profile.id === id && profile.specialization === 'writing',
  );
  if (matches.length !== 1) throw new Error('production_writing_profile_invalid');
  return matches[0]!;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${where} is required`);
  return value;
}

function positiveInteger(value: unknown, where: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${where} must be a positive integer`);
  }
  return value as number;
}

function stringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${where} must be a string array`);
  }
  return [...value] as string[];
}

function parseDocumentAgentProfile(value: unknown, index: number): DocumentAgentDeploymentProfile {
  const where = `UI4A_DOCUMENT_AGENT_PROFILES[${index}]`;
  if (!object(value)) throw new Error(`${where} must be an object`);
  if (value.runtimeClass !== 'document-agent') {
    throw new Error(`${where}.runtimeClass must be document-agent`);
  }
  if (value.transport !== 'sdk') throw new Error(`${where}.transport must be sdk`);
  if (value.artifactBackend !== 'isolated-document-workspace') {
    throw new Error(`${where}.artifactBackend must be isolated-document-workspace`);
  }
  if (value.networkPolicy !== 'none' && value.networkPolicy !== 'source-only') {
    throw new Error(`${where}.networkPolicy must be none or source-only`);
  }
  return {
    name: nonEmptyString(value.name, `${where}.name`),
    runtimeClass: value.runtimeClass,
    providerId: nonEmptyString(value.providerId, `${where}.providerId`),
    transport: value.transport,
    model: nonEmptyString(value.model, `${where}.model`),
    ...(value.endpoint === undefined
      ? {}
      : { endpoint: nonEmptyString(value.endpoint, `${where}.endpoint`) }),
    apiKeyEnv: nonEmptyString(value.apiKeyEnv, `${where}.apiKeyEnv`),
    artifactBackend: value.artifactBackend,
    timeoutSeconds: positiveInteger(value.timeoutSeconds, `${where}.timeoutSeconds`),
    maxTurns: positiveInteger(value.maxTurns, `${where}.maxTurns`),
    envAllowlist: stringArray(value.envAllowlist, `${where}.envAllowlist`),
    networkPolicy: value.networkPolicy,
  };
}

function parseAgentAuthoringProfile(
  value: unknown,
  index: number,
): AgentAuthoringDeploymentProfile {
  const where = `UI4A_AGENT_AUTHORING_PROFILES[${index}]`;
  if (!object(value)) throw new Error(`${where} must be an object`);
  if (value.runtimeClass !== 'agent-definition-authoring') {
    throw new Error(`${where}.runtimeClass must be agent-definition-authoring`);
  }
  if (value.transport !== 'sdk') throw new Error(`${where}.transport must be sdk`);
  if (value.networkPolicy !== 'none') throw new Error(`${where}.networkPolicy must be none`);
  return {
    name: nonEmptyString(value.name, `${where}.name`),
    runtimeClass: value.runtimeClass,
    providerId: nonEmptyString(value.providerId, `${where}.providerId`),
    transport: value.transport,
    model: nonEmptyString(value.model, `${where}.model`),
    ...(value.endpoint === undefined
      ? {}
      : { endpoint: nonEmptyString(value.endpoint, `${where}.endpoint`) }),
    apiKeyEnv: nonEmptyString(value.apiKeyEnv, `${where}.apiKeyEnv`),
    timeoutSeconds: positiveInteger(value.timeoutSeconds, `${where}.timeoutSeconds`),
    maxTurns: positiveInteger(value.maxTurns, `${where}.maxTurns`),
    envAllowlist: stringArray(value.envAllowlist, `${where}.envAllowlist`),
    networkPolicy: value.networkPolicy,
  };
}

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

/** Resolve one exact document runtime from deployment configuration; no default or fallback exists. */
export function documentAgentProfileFromEnvironment(name: string): DocumentAgentDeploymentProfile {
  const raw = process.env.UI4A_DOCUMENT_AGENT_PROFILES;
  if (raw === undefined) throw new Error(`document-agent profile ${name} is not configured`);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('UI4A_DOCUMENT_AGENT_PROFILES must be an array');
  const profiles = parsed.map(parseDocumentAgentProfile);
  const matches = profiles.filter((profile) => profile.name === name);
  if (matches.length !== 1) {
    throw new Error(`document-agent profile ${name} must resolve exactly once`);
  }
  return matches[0]!;
}

/** Adapt the server-owned canonical production default into the existing Writing contract. */
export function documentAgentProfileFromProductionConfig(
  config: ProductionDeploymentConfig,
): DocumentAgentDeploymentProfile {
  const profile = exactProductionWritingProfile(config);
  return {
    name: profile.id,
    runtimeClass: 'document-agent',
    providerId: 'codex',
    transport: 'sdk',
    model: config.settings.llm.model,
    endpoint: config.settings.llm.baseUrl,
    apiKeyEnv: config.settings.llm.apiKeyRef,
    artifactBackend: 'isolated-document-workspace',
    timeoutSeconds: profile.timeoutSeconds,
    maxTurns: PRODUCTION_WRITING_MAX_TURNS,
    envAllowlist: [],
    networkPolicy: 'none',
  };
}

/** Project private Provider configuration into the provider-neutral Runtime negotiation record. */
export function documentProfileAsAgentRuntime(
  profile: DocumentAgentDeploymentProfile,
): AgentRuntimeProfile {
  return {
    ref: profile.name,
    version: 1,
    runtimeClass: profile.runtimeClass,
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
  };
}

/** Resolve one exact authoring Runtime Profile without a document/coding fallback. */
export function agentAuthoringProfileFromEnvironment(
  name: string,
): AgentAuthoringDeploymentProfile {
  const raw = process.env.UI4A_AGENT_AUTHORING_PROFILES;
  if (raw === undefined) throw new Error(`Agent authoring profile ${name} is not configured`);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('UI4A_AGENT_AUTHORING_PROFILES must be an array');
  const profiles = parsed.map(parseAgentAuthoringProfile);
  const matches = profiles.filter((profile) => profile.name === name);
  if (matches.length !== 1) {
    throw new Error(`Agent authoring profile ${name} must resolve exactly once`);
  }
  return matches[0]!;
}

/** Project private authoring Provider configuration into runtime negotiation provenance. */
export function authoringProfileAsAgentRuntime(
  profile: AgentAuthoringDeploymentProfile,
): AgentRuntimeProfile {
  return {
    ref: profile.name,
    version: 1,
    runtimeClass: profile.runtimeClass,
    features: ['structured-result', 'streamed-events', 'cancel', 'resume'],
    tools: [],
    resourceBackends: [],
    providerAdapterRef: 'agent-definition-authoring-runtime@1',
    available: profile.providerId === 'codex',
    ...(profile.providerId === 'codex'
      ? {}
      : { unavailableReason: `Agent authoring Provider ${profile.providerId} is unavailable` }),
  };
}
