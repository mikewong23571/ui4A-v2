import type { IncomingMessage } from 'node:http';
import { lstatSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import type { HostProductionRuntimeProfile, ProductionDeploymentConfig } from '@ui4a/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProductionRunnerComposition,
  createProductionRunnerOneshotAdapter,
  runProductionDaemon,
  type RunnerCodexSdk,
} from './production.js';
import type { ResponsesLoopbackAdapterOptions } from './responses-loopback-adapter.js';
import type { RunnerDaemonOptions } from './runtime.js';

const image = `registry.internal/ui4a/agent-runner@sha256:${'a'.repeat(64)}`;
const apiKey = '__runner_codex_api_key__';
const runnerToken = 'runner-token.fixture-123';
const temporaryRoots: string[] = [];
const productionWorkspaceRoot = join('/dev/shm', `ui4a-agent-runner-${process.pid}`);
const hostWorkspaceRoot = join(productionWorkspaceRoot, 'host');
const kubernetesWorkspaceBase = join(productionWorkspaceRoot, 'kubernetes');
const kubernetesWorkspaceRoot = join(kubernetesWorkspaceBase, 'run:writing:1', 'agent');

beforeEach(async () => {
  await mkdir(hostWorkspaceRoot, { recursive: true, mode: 0o700 });
  await mkdir(kubernetesWorkspaceRoot, { recursive: true, mode: 0o700 });
});

afterEach(async () => {
  await Promise.all([
    ...temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
    rm(productionWorkspaceRoot, { force: true, recursive: true }),
  ]);
});

function configuration(): ProductionDeploymentConfig {
  return {
    settings: {
      deploymentMode: 'compose',
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
            workspaceRoot: hostWorkspaceRoot,
            timeoutSeconds: 30,
            resources: { cpu: '1', memory: '2Gi' },
            networkPolicy: 'restricted',
            credentialRefs: ['llm-api-key'],
          },
        ],
      },
    },
    secrets: {
      'llm-api-key': apiKey,
      'runner-token': runnerToken,
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

function kubernetesConfiguration(): ProductionDeploymentConfig {
  const config = configuration();
  config.settings.deploymentMode = 'kubernetes';
  delete (config.secrets as Record<string, string>)['runner-token'];
  config.settings.runtime.profiles = [
    {
      id: 'writing-k8s',
      specialization: 'writing',
      backend: 'kubernetes',
      image,
      workspaceRoot: kubernetesWorkspaceBase,
      timeoutSeconds: 30,
      resources: { cpu: '1', memory: '2Gi' },
      networkPolicy: 'restricted',
      credentialRefs: ['llm-api-key'],
    },
  ];
  return config;
}

function kubernetesEnvironment(): NodeJS.ProcessEnv {
  return {
    UI4A_DEPLOYMENT_PROFILE: 'production',
    UI4A_RUNNER_PROFILE_ID: 'writing-k8s',
    UI4A_RUNNER_IMAGE: image,
  };
}

function kubernetesDelivery() {
  const value = delivery();
  value.execution.profileId = 'writing-k8s';
  (value.execution as { backend: string }).backend = 'kubernetes-job';
  value.execution.workspace.rootRef = kubernetesWorkspaceRoot;
  return value;
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
      workspace: { rootRef: hostWorkspaceRoot },
      resources: { cpu: '1', memory: '2Gi', timeoutMs: 30_000 },
      networkPolicy: 'restricted' as const,
      credentialRefs: ['llm-api-key'],
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

function responsesAdapter() {
  const close = vi.fn(async () => undefined);
  const start = vi.fn(async (options: ResponsesLoopbackAdapterOptions) => {
    void options;
    return {
      baseUrl: 'http://127.0.0.1:43123/v1',
      close,
    };
  });
  return { start, close };
}

function composition(
  overrides: { config?: ProductionDeploymentConfig; env?: NodeJS.ProcessEnv } = {},
) {
  const transport = sdk();
  const adapter = responsesAdapter();
  const result = createProductionRunnerComposition(overrides.env ?? environment(), {
    loadConfiguration: () => overrides.config ?? configuration(),
    createClient: transport.createClient,
    scheduleTimeout: () => () => undefined,
    startResponsesAdapter: adapter.start,
  });
  if (result === undefined) throw new Error('expected production composition');
  return { ...result, transport, adapter };
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
    await expect(
      authorizeDelivery(request(['Bearer first', `Bearer ${runnerToken}`])),
    ).resolves.toBe(false);
    await expect(authorizeDelivery(request())).resolves.toBe(false);
  });

  it('executes one strict generic compiled request with server-owned Codex options', async () => {
    const { processor, transport, adapter } = composition();

    const result = await processor.execute(delivery());

    expect(transport.createClient).toHaveBeenCalledOnce();
    expect(transport.clientOptions).toEqual([
      {
        apiKey,
        config: {
          model_provider: 'ui4a',
          model_providers: {
            ui4a: {
              name: 'UI4A Production',
              base_url: 'http://127.0.0.1:43123/v1',
              env_key: 'CODEX_API_KEY',
              wire_api: 'responses',
              supports_websockets: false,
            },
          },
        },
        env: expect.objectContaining({
          LANG: 'C.UTF-8',
          HOME: hostWorkspaceRoot,
          CODEX_HOME: join(hostWorkspaceRoot, '.codex'),
        }),
      },
    ]);
    expect(transport.threadOptions).toEqual([
      {
        model: 'server-owned-model',
        workingDirectory: hostWorkspaceRoot,
        skipGitRepoCheck: true,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        networkAccessEnabled: false,
      },
    ]);
    expect(adapter.start).toHaveBeenCalledWith({
      upstreamBaseUrl: 'https://llm.mothership.internal/v1',
      requestTimeoutMs: 60_000,
    });
    expect(adapter.close).toHaveBeenCalledOnce();
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
  });

  it('creates one private writable Codex home inside the sealed workspace before SDK use', async () => {
    const { processor } = composition();

    await expect(processor.execute(delivery())).resolves.toMatchObject({ status: 'succeeded' });

    const codexHome = join(hostWorkspaceRoot, '.codex');
    const facts = lstatSync(codexHome);
    expect(facts.isDirectory()).toBe(true);
    expect(facts.isSymbolicLink()).toBe(false);
    expect(facts.mode & 0o777).toBe(0o700);
    expect(facts.uid).toBe(process.getuid?.());
  });

  it.each([
    ['symlink', async (path: string) => symlink('/tmp', path)],
    [
      'non-private mode',
      async (path: string) => {
        await mkdir(path, { mode: 0o700 });
        await chmod(path, 0o755);
      },
    ],
  ])('rejects a %s Codex home before SDK construction', async (_label, prepare) => {
    const codexHome = join(hostWorkspaceRoot, '.codex');
    await prepare(codexHome);
    const { processor, transport } = composition();

    await expect(processor.execute(delivery())).rejects.toThrow('runner_execution_failed');
    expect(transport.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ['profile', (value: ReturnType<typeof delivery>) => (value.execution.profileId = 'other')],
    [
      'backend',
      (value: ReturnType<typeof delivery>) =>
        ((value.execution as { backend: string }).backend = 'kubernetes-job'),
    ],
    ['image', (value: ReturnType<typeof delivery>) => (value.execution.image = `${image}0`)],
    [
      'workspace',
      (value: ReturnType<typeof delivery>) => (value.execution.workspace.rootRef = '/tmp/request'),
    ],
    ['cpu', (value: ReturnType<typeof delivery>) => (value.execution.resources.cpu = '99')],
    ['memory', (value: ReturnType<typeof delivery>) => (value.execution.resources.memory = '99Gi')],
    ['timeout', (value: ReturnType<typeof delivery>) => (value.execution.resources.timeoutMs = 1)],
    [
      'network',
      (value: ReturnType<typeof delivery>) =>
        ((value.execution as { networkPolicy: string }).networkPolicy = 'unrestricted'),
    ],
    [
      'credentials',
      (value: ReturnType<typeof delivery>) => (value.execution.credentialRefs = ['codex-token']),
    ],
    [
      'contract',
      (value: ReturnType<typeof delivery>) => (value.request.task.contractRef = 'other@1'),
    ],
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
      ...(ambiguous.settings.runtime.profiles[0] as HostProductionRuntimeProfile),
      id: 'authoring-host',
      specialization: 'authoring',
      runnerTokenRef: 'other-runner-token',
    });
    expect(() => composition({ config: ambiguous })).toThrow('runner_production_config_invalid');
  });

  it('rejects a profile that did not authorize the configured LLM Secret before SDK creation', () => {
    const config = configuration();
    config.settings.runtime.profiles[0]!.credentialRefs = ['codex-token'];
    (config.secrets as Record<string, string>)['codex-token'] = '__profile_token__';
    const transport = sdk();

    expect(() =>
      createProductionRunnerComposition(environment(), {
        loadConfiguration: () => config,
        createClient: transport.createClient,
      }),
    ).toThrow('runner_production_config_invalid');
    expect(transport.createClient).not.toHaveBeenCalled();
  });

  it('rejects a full deployment Secret canary before constructing the SDK', () => {
    const config = configuration();
    (config.secrets as Record<string, string>)['postgres-runtime-password'] = '__postgres_canary__';
    const transport = sdk();

    expect(() =>
      createProductionRunnerComposition(environment(), {
        loadConfiguration: () => config,
        createClient: transport.createClient,
      }),
    ).toThrow('runner_production_config_invalid');
    expect(transport.createClient).not.toHaveBeenCalled();
  });

  it('bounds the aggregate streamed event count without returning a partial candidate', async () => {
    const adapter = responsesAdapter();
    let yielded = 0;
    const client: RunnerCodexSdk = {
      startThread() {
        return {
          id: 'thread-overflow',
          async runStreamed() {
            async function* events() {
              yielded += 1;
              yield { type: 'thread.started', thread_id: 'thread-overflow' };
              for (let index = 0; index < 4_097; index += 1) {
                yielded += 1;
                yield { type: 'turn.started', index };
              }
            }
            return { events: events() };
          },
        };
      },
    };
    const created = createProductionRunnerComposition(kubernetesEnvironment(), {
      loadConfiguration: () => kubernetesConfiguration(),
      createClient: () => client,
      startResponsesAdapter: adapter.start,
      scheduleTimeout: () => () => undefined,
    });

    await expect(created!.processor.execute(kubernetesDelivery())).rejects.toThrow(
      'runner_execution_failed',
    );
    expect(yielded).toBeLessThan(4_098);
    expect(adapter.close).toHaveBeenCalledOnce();
  });

  it('passes the production processor, authorizer, and readiness into daemon startup', async () => {
    const runDaemon = vi.fn(
      async (environment: NodeJS.ProcessEnv, options?: RunnerDaemonOptions) => {
        void environment;
        void options;
      },
    );
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
    const daemonOptions = runDaemon.mock.calls[0]?.[1];
    expect(daemonOptions?.backendReadiness?.()).toEqual({
      registered: true,
      deliveryAvailable: true,
    });
  });

  it('executes a Kubernetes one-shot through the same sealed processor and generic Codex executor', async () => {
    const transport = sdk();
    const adapter = responsesAdapter();
    const created = createProductionRunnerComposition(kubernetesEnvironment(), {
      loadConfiguration: () => kubernetesConfiguration(),
      createClient: transport.createClient,
      scheduleTimeout: () => () => undefined,
      startResponsesAdapter: adapter.start,
    });

    expect(created).toBeDefined();
    await expect(created!.processor.execute(kubernetesDelivery())).resolves.toMatchObject({
      status: 'succeeded',
      candidate: {
        schemaVersion: 1,
        nativeSessionId: 'thread-writing-1',
        result: { markdown: '# Candidate' },
      },
    });
    expect(transport.createClient).toHaveBeenCalledOnce();
    expect(transport.clientOptions).toEqual([
      {
        apiKey,
        config: {
          model_provider: 'ui4a',
          model_providers: {
            ui4a: {
              name: 'UI4A Production',
              base_url: 'http://127.0.0.1:43123/v1',
              env_key: 'CODEX_API_KEY',
              wire_api: 'responses',
              supports_websockets: false,
            },
          },
        },
        env: expect.objectContaining({
          LANG: 'C.UTF-8',
          HOME: kubernetesWorkspaceRoot,
          CODEX_HOME: join(kubernetesWorkspaceRoot, '.codex'),
        }),
      },
    ]);
    expect(transport.clientOptions[0]).not.toHaveProperty('baseUrl');
    expect(transport.clientOptions[0]?.env?.HOME).not.toMatch(/^\/tmp(?:\/|$)/u);
    expect(transport.clientOptions[0]?.env?.CODEX_HOME).not.toMatch(/^\/tmp(?:\/|$)/u);
    expect(transport.threadOptions).toEqual([
      expect.objectContaining({
        workingDirectory: kubernetesWorkspaceRoot,
      }),
    ]);
    expect(adapter.start).toHaveBeenCalledWith({
      upstreamBaseUrl: 'https://llm.mothership.internal/v1',
      requestTimeoutMs: 60_000,
    });
    expect(adapter.close).toHaveBeenCalledOnce();
    expect(created!.backendReadiness()).toEqual({ registered: true, deliveryAvailable: false });
    await expect(created!.authorizeDelivery({ headers: {} } as IncomingMessage)).resolves.toBe(
      false,
    );
  });

  it('closes the loopback adapter when Codex client construction fails', async () => {
    const adapter = responsesAdapter();
    const created = createProductionRunnerComposition(kubernetesEnvironment(), {
      loadConfiguration: () => kubernetesConfiguration(),
      createClient: () => {
        throw new Error('sdk construction failed with sensitive detail');
      },
      startResponsesAdapter: adapter.start,
      scheduleTimeout: () => () => undefined,
    });

    await expect(created!.processor.execute(kubernetesDelivery())).rejects.toThrow(
      'runner_execution_failed',
    );
    expect(adapter.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['canonical base instead of a per-Run root', kubernetesWorkspaceBase],
    ['another Run root', join(kubernetesWorkspaceBase, 'run:other', 'agent')],
    ['normalized escape', join(kubernetesWorkspaceRoot, '..', '..', 'other')],
    ['absolute escape', '/tmp/run:writing:1/agent'],
  ])('rejects Kubernetes workspace %s before SDK construction', async (_label, rootRef) => {
    const transport = sdk();
    const created = createProductionRunnerComposition(kubernetesEnvironment(), {
      loadConfiguration: () => kubernetesConfiguration(),
      createClient: transport.createClient,
      scheduleTimeout: () => () => undefined,
    });
    const input = kubernetesDelivery();
    input.execution.workspace.rootRef = rootRef;

    await expect(created!.processor.execute(input)).rejects.toThrow('runner_execution_failed');
    expect(transport.createClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      'backend',
      (value: ReturnType<typeof kubernetesDelivery>) =>
        ((value.execution as { backend: string }).backend = 'trusted-host'),
    ],
    [
      'image',
      (value: ReturnType<typeof kubernetesDelivery>) => (value.execution.image = `${image}0`),
    ],
    [
      'profile',
      (value: ReturnType<typeof kubernetesDelivery>) => (value.execution.profileId = 'other'),
    ],
    [
      'credentials',
      (value: ReturnType<typeof kubernetesDelivery>) =>
        (value.execution.credentialRefs = ['codex-token']),
    ],
    [
      'contract',
      (value: ReturnType<typeof kubernetesDelivery>) =>
        (value.request.task.contractRef = 'request-selected@1'),
    ],
  ])('rejects Kubernetes %s override before SDK construction', async (_label, mutate) => {
    const transport = sdk();
    const created = createProductionRunnerComposition(kubernetesEnvironment(), {
      loadConfiguration: () => kubernetesConfiguration(),
      createClient: transport.createClient,
      scheduleTimeout: () => () => undefined,
    });
    const input = kubernetesDelivery();
    mutate(input);

    await expect(created!.processor.execute(input)).rejects.toThrow('runner_execution_failed');
    expect(transport.createClient).not.toHaveBeenCalled();
  });

  it('reads a bounded regular Kubernetes delivery file without creating another wire format', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ui4a-k8s-runner-'));
    temporaryRoots.push(root);
    const deliveryFile = join(root, 'delivery.json');
    await writeFile(deliveryFile, JSON.stringify(kubernetesDelivery()));
    const transport = sdk();
    const env = { ...kubernetesEnvironment(), UI4A_RUNNER_DELIVERY_FILE: deliveryFile };
    const adapter = createProductionRunnerOneshotAdapter(env, {
      loadConfiguration: () => kubernetesConfiguration(),
      createClient: transport.createClient,
      scheduleTimeout: () => () => undefined,
    });

    expect(adapter).toBeDefined();
    const sealed = await adapter!.readDelivery(env);
    expect(sealed).toEqual(kubernetesDelivery());
    await expect(adapter!.processor.execute(sealed)).resolves.toMatchObject({
      status: 'succeeded',
    });
  });

  it('fails closed for missing, symlinked, or invalid one-shot delivery sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ui4a-k8s-runner-invalid-'));
    temporaryRoots.push(root);
    const target = join(root, 'target.json');
    const link = join(root, 'delivery.json');
    await writeFile(target, JSON.stringify(kubernetesDelivery()));
    await symlink(target, link);
    const baseDependencies = {
      loadConfiguration: () => kubernetesConfiguration(),
      createClient: sdk().createClient,
    };

    expect(() =>
      createProductionRunnerOneshotAdapter(kubernetesEnvironment(), baseDependencies),
    ).toThrow('runner_delivery_source_invalid');
    expect(() =>
      createProductionRunnerOneshotAdapter(
        { ...kubernetesEnvironment(), UI4A_RUNNER_DELIVERY_FILE: link },
        baseDependencies,
      ),
    ).toThrow('runner_delivery_source_invalid');

    await writeFile(target, '{not-json');
    const adapter = createProductionRunnerOneshotAdapter(
      { ...kubernetesEnvironment(), UI4A_RUNNER_DELIVERY_FILE: target },
      baseDependencies,
    );
    await expect(adapter!.readDelivery(kubernetesEnvironment())).rejects.toThrow(
      'runner_delivery_source_invalid',
    );
  });
});
