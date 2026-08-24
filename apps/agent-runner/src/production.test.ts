import type { IncomingMessage } from 'node:http';

import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import type { ProductionDeploymentConfig } from '@ui4a/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  createProductionRunnerComposition,
  runProductionDaemon,
  type RunnerCodexSdk,
} from './production.js';

const image = `registry.internal/ui4a/agent-runner@sha256:${'a'.repeat(64)}`;
const apiKey = '__runner_codex_api_key__';
const runnerToken = 'runner-token.fixture-123';

function configuration(): ProductionDeploymentConfig {
  return {
    settings: {
      llm: {
        baseUrl: 'https://llm.mothership.internal/v1',
        model: 'server-owned-model',
        apiKeyRef: 'llm-api-key',
        requestTimeoutMs: 60_000,
      },
      runtime: {
        defaultProfiles: {
          coding: 'coding-k8s',
          writing: 'writing-host',
          authoring: 'authoring-k8s',
        },
        profiles: [
          {
            id: 'writing-host',
            specialization: 'writing',
            backend: 'host',
            runnerId: 'runner-1',
            runnerTokenRef: 'runner-token',
            workspaceRoot: '/srv/ui4a/workspaces/writing',
            timeoutSeconds: 30,
            resources: { cpu: '1', memory: '2Gi' },
            networkPolicy: 'restricted',
            credentialRefs: ['codex-token'],
          },
        ],
      },
    },
    secrets: {
      'llm-api-key': apiKey,
      'runner-token': runnerToken,
      'codex-token': '__profile_codex_token__',
    },
  } as unknown as ProductionDeploymentConfig;
}

function environment(): NodeJS.ProcessEnv {
  return {
    UI4A_DEPLOYMENT_PROFILE: 'production',
    UI4A_RUNNER_ID: 'runner-1',
    UI4A_RUNNER_IMAGE: image,
  };
}

function compiledPayload() {
  return {
    schemaVersion: 1 as const,
    compiledHash: `sha256:${'2'.repeat(64)}`,
    messages: [
      { role: 'system' as const, content: 'Follow the compiled contract.' },
      { role: 'user' as const, content: 'Produce structured output.' },
    ],
    outputSchema: {
      type: 'object',
      properties: { markdown: { type: 'string' } },
      required: ['markdown'],
      additionalProperties: false,
    },
    sandboxMode: 'read-only' as const,
  };
}

function delivery() {
  const payload = compiledPayload();
  return {
    schemaVersion: 1 as const,
    deliveryId: 'delivery:writing:1',
    request: {
      schemaVersion: 1 as const,
      runId: 'run:writing:1',
      specialization: 'writing' as const,
      birth: {
        definitionRef: 'writing-agent@1',
        definitionHash: `sha256:${'1'.repeat(64)}`,
        promptHash: payload.compiledHash,
        runtimeHash: `sha256:${'3'.repeat(64)}`,
        taskContractHash: `sha256:${'4'.repeat(64)}`,
        resultContractHash: `sha256:${'5'.repeat(64)}`,
      },
      task: {
        contractRef: 'generic-codex-transport@1',
        payload,
        contextRefs: [],
      },
    },
    execution: {
      profileId: 'writing-host',
      backend: 'trusted-host' as const,
      image,
      workspace: { rootRef: '/srv/ui4a/workspaces/writing' },
      resources: { cpu: '1', memory: '2Gi', timeoutMs: 30_000 },
      networkPolicy: 'restricted' as const,
      credentialRefs: ['codex-token'],
    },
  };
}

function sdk() {
  const clientOptions: CodexOptions[] = [];
  const threadOptions: ThreadOptions[] = [];
  const prompts: Array<{ input: string; options: unknown }> = [];
  const client: RunnerCodexSdk = {
    startThread(options) {
      threadOptions.push(options ?? {});
      return {
        id: 'thread-writing-1',
        async runStreamed(input, options) {
          prompts.push({ input, options });
          async function* events() {
            yield { type: 'thread.started', thread_id: 'thread-writing-1' };
            yield {
              type: 'item.completed',
              item: {
                id: 'message-1',
                type: 'agent_message',
                text: '{"markdown":"# Candidate"}',
              },
            };
            yield {
              type: 'turn.completed',
              usage: {
                input_tokens: 1,
                cached_input_tokens: 0,
                cache_write_input_tokens: 0,
                output_tokens: 1,
                reasoning_output_tokens: 0,
              },
            };
          }
          return { events: events() };
        },
      };
    },
  };
  const createClient = vi.fn((options: CodexOptions) => {
    clientOptions.push(options);
    return client;
  });
  return { createClient, clientOptions, threadOptions, prompts };
}

function composition(overrides: { config?: ProductionDeploymentConfig; env?: NodeJS.ProcessEnv } = {}) {
  const transport = sdk();
  const result = createProductionRunnerComposition(overrides.env ?? environment(), {
    loadConfiguration: () => overrides.config ?? configuration(),
    createClient: transport.createClient,
    scheduleTimeout: () => () => undefined,
  });
  if (result === undefined) throw new Error('expected production composition');
  return { ...result, transport };
}

describe('Agent Runner production composition', () => {
  it('fails closed for missing or invalid production configuration while local stays unavailable', () => {
    expect(createProductionRunnerComposition({}, {})).toBeUndefined();
    expect(() =>
      createProductionRunnerComposition(
        { UI4A_DEPLOYMENT_PROFILE: 'production', UI4A_RUNNER_ID: 'runner-1' },
        { loadConfiguration: () => undefined },
      ),
    ).toThrow('runner_production_config_invalid');
    expect(() =>
      createProductionRunnerComposition(environment(), {
        loadConfiguration: () => {
          throw new Error('secret path and value must not escape');
        },
      }),
    ).toThrow('runner_production_config_invalid');
  });

  it('authorizes only the exact Bearer token through a constant-time digest comparison', async () => {
    const { authorizeDelivery } = composition();
    const request = (authorization?: string | string[]) =>
      ({ headers: { authorization } }) as unknown as IncomingMessage;

    await expect(authorizeDelivery(request(`Bearer ${runnerToken}`))).resolves.toBe(true);
    await expect(authorizeDelivery(request(`bearer ${runnerToken}`))).resolves.toBe(false);
    await expect(authorizeDelivery(request(`Bearer ${runnerToken}x`))).resolves.toBe(false);
    await expect(authorizeDelivery(request(['Bearer first', `Bearer ${runnerToken}`]))).resolves.toBe(
      false,
    );
    await expect(authorizeDelivery(request())).resolves.toBe(false);
  });

  it('executes one strict generic compiled request with server-owned Codex options', async () => {
    const { processor, transport } = composition();

    const result = await processor.execute(delivery());

    expect(transport.createClient).toHaveBeenCalledOnce();
    expect(transport.clientOptions).toEqual([
      {
        apiKey,
        baseUrl: 'https://llm.mothership.internal/v1',
        env: expect.objectContaining({ LANG: 'C.UTF-8' }),
      },
    ]);
    expect(transport.threadOptions).toEqual([
      {
        model: 'server-owned-model',
        workingDirectory: '/srv/ui4a/workspaces/writing',
        skipGitRepoCheck: true,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        networkAccessEnabled: false,
      },
    ]);
    expect(transport.prompts[0]).toMatchObject({
      input: expect.stringContaining('<<<UI4A_COMPILED_MESSAGE_V1 role="system">>>'),
      options: { outputSchema: compiledPayload().outputSchema, signal: expect.any(AbortSignal) },
    });
    expect(result.candidate).toEqual({
      schemaVersion: 1,
      nativeSessionId: 'thread-writing-1',
      result: { markdown: '# Candidate' },
      events: expect.arrayContaining([expect.objectContaining({ type: 'thread.started' })]),
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(JSON.stringify(result)).not.toContain('__profile_codex_token__');
  });

  it.each([
    ['profile', (value: ReturnType<typeof delivery>) => (value.execution.profileId = 'other')],
    ['backend', (value: ReturnType<typeof delivery>) => (value.execution.backend = 'kubernetes-job')],
    ['image', (value: ReturnType<typeof delivery>) => (value.execution.image = `${image}0`)],
    [
      'workspace',
      (value: ReturnType<typeof delivery>) => (value.execution.workspace.rootRef = '/tmp/request'),
    ],
    ['cpu', (value: ReturnType<typeof delivery>) => (value.execution.resources.cpu = '99')],
    ['memory', (value: ReturnType<typeof delivery>) => (value.execution.resources.memory = '99Gi')],
    ['timeout', (value: ReturnType<typeof delivery>) => (value.execution.resources.timeoutMs = 1)],
    [
      'credentials',
      (value: ReturnType<typeof delivery>) => (value.execution.credentialRefs = ['llm-api-key']),
    ],
    ['contract', (value: ReturnType<typeof delivery>) => (value.request.task.contractRef = 'other@1')],
    [
      'compiled hash',
      (value: ReturnType<typeof delivery>) =>
        (value.request.task.payload.compiledHash = `sha256:${'9'.repeat(64)}`),
    ],
  ])('rejects wrong %s before constructing a Codex client', async (_label, mutate) => {
    const { processor, transport } = composition();
    const input = delivery();
    mutate(input);

    await expect(processor.execute(input)).rejects.toThrow('runner_execution_failed');
    expect(transport.createClient).not.toHaveBeenCalled();
  });

  it('rejects runner identity/profile token ambiguity before serving', () => {
    expect(() => composition({ env: { ...environment(), UI4A_RUNNER_ID: 'runner-2' } })).toThrow(
      'runner_production_config_invalid',
    );
    const ambiguous = configuration();
    ambiguous.settings.runtime.profiles.push({
      ...ambiguous.settings.runtime.profiles[0]!,
      id: 'authoring-host',
      specialization: 'authoring',
      runnerTokenRef: 'other-runner-token',
    });
    expect(() => composition({ config: ambiguous })).toThrow('runner_production_config_invalid');
  });

  it('passes the production processor, authorizer, and readiness into daemon startup', async () => {
    const runDaemon = vi.fn(async () => undefined);
    const created = composition();
    await runProductionDaemon(environment(), {
      compose: () => created,
      runDaemon,
    });

    expect(runDaemon).toHaveBeenCalledWith(
      environment(),
      expect.objectContaining({
        deliveryProcessor: created.processor,
        authorizeDelivery: created.authorizeDelivery,
        backendReadiness: expect.any(Function),
      }),
    );
    expect(runDaemon.mock.calls[0]?.[1]?.backendReadiness()).toEqual({
      registered: true,
      deliveryAvailable: true,
    });
  });
});
