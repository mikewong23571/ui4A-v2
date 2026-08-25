import { accessSync, constants, lstatSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import type { ProductionDeploymentConfig, ProductionRuntimeProfile } from '@ui4a/shared';

import type { RunnerDelivery } from './process.js';
import type { startResponsesLoopbackAdapter } from './responses-loopback-adapter.js';

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const compiledFields = [
  'schemaVersion',
  'compiledHash',
  'messages',
  'outputSchema',
  'sandboxMode',
] as const;
const maxStreamedEvents = 4_096;
const maxStreamedEventBytes = 8 * 1024 * 1024;

interface CompiledCodexRequest {
  schemaVersion: 1;
  compiledHash: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  outputSchema: unknown;
  sandboxMode: 'read-only' | 'workspace-write';
}

export interface RunnerCodexThread {
  readonly id: string | null;
  runStreamed(
    input: string,
    options?: { outputSchema?: unknown; signal?: AbortSignal },
  ): Promise<{ events: AsyncGenerator<unknown> }>;
}

export interface RunnerCodexSdk {
  startThread(options?: ThreadOptions): RunnerCodexThread;
}

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('runner_execution_failed');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (typeof value === 'string') return secrets.some((secret) => value.includes(secret));
  if (Array.isArray(value)) return value.some((child) => containsSecret(child, secrets));
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value as Record<string, unknown>).some((child) =>
    containsSecret(child, secrets),
  );
}

export function parseCompiledRequest(delivery: RunnerDelivery): CompiledCodexRequest {
  if (delivery.request.task.contractRef !== 'generic-codex-transport@1') {
    throw new Error('runner_execution_failed');
  }
  const candidate = record(delivery.request.task.payload);
  if (
    !exactKeys(candidate, compiledFields) ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.compiledHash !== 'string' ||
    !digestPattern.test(candidate.compiledHash) ||
    candidate.compiledHash !== delivery.request.birth.promptHash ||
    !Array.isArray(candidate.messages) ||
    candidate.messages.length === 0 ||
    !['read-only', 'workspace-write'].includes(String(candidate.sandboxMode))
  ) {
    throw new Error('runner_execution_failed');
  }
  const messages = candidate.messages.map((value) => {
    const message = record(value);
    if (
      !exactKeys(message, ['role', 'content']) ||
      !['system', 'user', 'assistant'].includes(String(message.role)) ||
      typeof message.content !== 'string'
    ) {
      throw new Error('runner_execution_failed');
    }
    return {
      role: message.role,
      content: message.content,
    } as CompiledCodexRequest['messages'][number];
  });
  let outputSchema: unknown;
  try {
    outputSchema = structuredClone(candidate.outputSchema);
  } catch {
    throw new Error('runner_execution_failed');
  }
  return {
    schemaVersion: 1,
    compiledHash: candidate.compiledHash,
    messages,
    outputSchema,
    sandboxMode: candidate.sandboxMode as CompiledCodexRequest['sandboxMode'],
  };
}

function serializeMessages(messages: CompiledCodexRequest['messages']): string {
  return messages
    .flatMap((message, index) => [
      `<<<UI4A_COMPILED_MESSAGE_V1 role=${JSON.stringify(message.role)}>>>`,
      message.content,
      '<<<END_UI4A_COMPILED_MESSAGE_V1>>>',
      ...(index === messages.length - 1 ? [] : ['']),
    ])
    .join('\n');
}

export function matchingProfile(
  delivery: RunnerDelivery,
  profiles: readonly ProductionRuntimeProfile[],
  runnerImage: string,
): ProductionRuntimeProfile {
  const matches = profiles.filter(
    (profile) =>
      profile.id === delivery.execution.profileId &&
      profile.specialization === delivery.request.specialization,
  );
  if (matches.length !== 1) throw new Error('runner_execution_failed');
  const profile = matches[0]!;
  const expectedBackend = profile.backend === 'host' ? 'trusted-host' : 'kubernetes-job';
  const expectedImage = profile.backend === 'host' ? runnerImage : profile.image;
  const workspaceRoot = delivery.execution.workspace.rootRef;
  if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(delivery.request.runId)) {
    throw new Error('runner_execution_failed');
  }
  const base = resolve(profile.workspaceRoot);
  const expected = resolve(join(base, delivery.request.runId, 'agent'));
  const child = relative(base, expected);
  const workspaceMatches =
    isAbsolute(workspaceRoot) &&
    workspaceRoot === resolve(workspaceRoot) &&
    workspaceRoot === expected &&
    child !== '' &&
    !child.startsWith('..') &&
    !isAbsolute(child);
  if (
    delivery.execution.backend !== expectedBackend ||
    delivery.execution.image !== expectedImage ||
    !workspaceMatches ||
    delivery.execution.resources.cpu !== profile.resources.cpu ||
    delivery.execution.resources.memory !== profile.resources.memory ||
    delivery.execution.resources.timeoutMs !== profile.timeoutSeconds * 1_000 ||
    delivery.execution.networkPolicy !== profile.networkPolicy ||
    !sameStrings(delivery.execution.credentialRefs, profile.credentialRefs)
  ) {
    throw new Error('runner_execution_failed');
  }
  return profile;
}

function parseAgentResult(event: Record<string, unknown>): unknown | undefined {
  if (event.type !== 'item.completed') return undefined;
  const item = record(event.item);
  if (item.type !== 'agent_message' || typeof item.text !== 'string') return undefined;
  try {
    return JSON.parse(item.text) as unknown;
  } catch {
    throw new Error('runner_execution_failed');
  }
}

function codexWorkspaceEnvironment(workspaceRoot: string): Record<string, string> {
  const canonicalRoot = resolve(workspaceRoot);
  const codexHome = resolve(join(canonicalRoot, '.codex'));
  const codexHomeRelative = relative(canonicalRoot, codexHome);
  if (
    !isAbsolute(workspaceRoot) ||
    workspaceRoot !== canonicalRoot ||
    codexHomeRelative === '' ||
    codexHomeRelative.startsWith('..') ||
    isAbsolute(codexHomeRelative)
  ) {
    throw new Error('runner_execution_failed');
  }
  try {
    const uid = process.getuid?.();
    const workspaceFacts = lstatSync(canonicalRoot);
    if (
      uid === undefined ||
      !workspaceFacts.isDirectory() ||
      workspaceFacts.isSymbolicLink() ||
      workspaceFacts.uid !== uid
    ) {
      throw new Error('runner_execution_failed');
    }
    accessSync(canonicalRoot, constants.R_OK | constants.W_OK | constants.X_OK);
    try {
      mkdirSync(codexHome, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const codexHomeFacts = lstatSync(codexHome);
    if (
      !codexHomeFacts.isDirectory() ||
      codexHomeFacts.isSymbolicLink() ||
      codexHomeFacts.uid !== uid ||
      (codexHomeFacts.mode & 0o777) !== 0o700
    ) {
      throw new Error('runner_execution_failed');
    }
    accessSync(codexHome, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw new Error('runner_execution_failed');
  }
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    HOME: canonicalRoot,
    CODEX_HOME: codexHome,
  };
}

export async function executeCodex(input: {
  delivery: RunnerDelivery;
  request: CompiledCodexRequest;
  profile: ProductionRuntimeProfile;
  signal: AbortSignal;
  configuration: ProductionDeploymentConfig;
  resolvedSecrets: Readonly<Record<string, string>>;
  createClient: (options: CodexOptions) => RunnerCodexSdk;
  startResponsesAdapter: typeof startResponsesLoopbackAdapter;
}): Promise<{
  candidate: { schemaVersion: 1; nativeSessionId: string; result: unknown; events: unknown[] };
  artifacts: [];
}> {
  const { settings } = input.configuration;
  const apiKey = input.resolvedSecrets[settings.llm.apiKeyRef];
  if (apiKey === undefined || apiKey === '') throw new Error('runner_execution_failed');
  const secretValues = Object.values(input.configuration.secrets).filter((value) => value !== '');
  if (containsSecret(input.request, secretValues)) throw new Error('runner_execution_failed');
  const workspaceRoot = input.delivery.execution.workspace.rootRef;
  const adapter = await input.startResponsesAdapter({
    upstreamBaseUrl: settings.llm.baseUrl,
    requestTimeoutMs: settings.llm.requestTimeoutMs,
  });
  try {
    const client = input.createClient({
      apiKey,
      config: {
        model_provider: 'ui4a',
        model_providers: {
          ui4a: {
            name: 'UI4A Production',
            base_url: adapter.baseUrl,
            env_key: 'CODEX_API_KEY',
            wire_api: 'responses',
            supports_websockets: false,
          },
        },
      },
      env: codexWorkspaceEnvironment(workspaceRoot),
    });
    const thread = client.startThread({
      model: settings.llm.model,
      workingDirectory: workspaceRoot,
      skipGitRepoCheck: true,
      sandboxMode: input.request.sandboxMode,
      approvalPolicy: 'never',
      networkAccessEnabled: false,
    });
    const streamed = await thread.runStreamed(serializeMessages(input.request.messages), {
      outputSchema: input.request.outputSchema,
      signal: input.signal,
    });
    let nativeSessionId: string | undefined;
    let result: unknown;
    const events: unknown[] = [];
    let eventBytes = 0;
    for await (const value of streamed.events) {
      let event: Record<string, unknown>;
      try {
        event = structuredClone(record(value));
      } catch {
        throw new Error('runner_execution_failed');
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(event);
      } catch {
        throw new Error('runner_execution_failed');
      }
      eventBytes += Buffer.byteLength(serialized, 'utf8');
      if (events.length >= maxStreamedEvents || eventBytes > maxStreamedEventBytes) {
        throw new Error('runner_execution_failed');
      }
      events.push(event);
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        nativeSessionId = event.thread_id;
      }
      const parsed = parseAgentResult(event);
      if (parsed !== undefined) result = parsed;
      if (event.type === 'turn.failed' || event.type === 'error') {
        throw new Error('runner_execution_failed');
      }
    }
    nativeSessionId ??= thread.id ?? undefined;
    if (nativeSessionId === undefined || nativeSessionId === '' || result === undefined) {
      throw new Error('runner_execution_failed');
    }
    const candidate = { schemaVersion: 1 as const, nativeSessionId, result, events };
    if (containsSecret(candidate, secretValues)) throw new Error('runner_execution_failed');
    return { candidate, artifacts: [] };
  } finally {
    await adapter.close();
  }
}
