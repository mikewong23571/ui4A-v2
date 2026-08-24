import { describe, expect, it, vi } from 'vitest';

import type { RuntimeBackendExecutionPort, SealedRunnerEnvelope } from './backend';

interface HttpRunnerExecutionModule {
  createHttpRunnerExecutionPort(input: {
    origin: string;
    authorizationHeader: string;
    fetchImpl: typeof fetch;
    timeoutMs: number;
  }): RuntimeBackendExecutionPort;
}

interface RunnerDeliveryWire {
  schemaVersion: 1;
  deliveryId: string;
  request: {
    schemaVersion: 1;
    runId: string;
    specialization: 'coding' | 'writing' | 'authoring';
    birth: SealedRunnerEnvelope['birth'];
    task: SealedRunnerEnvelope['task'];
  };
  execution: {
    profileId: string;
    backend: 'kubernetes-job' | 'trusted-host';
    image: string;
    workspace: { rootRef: string };
    resources: { cpu: string; memory: string; timeoutMs: number };
    networkPolicy: 'restricted';
    credentialRefs: string[];
  };
}

const plannedModulePath = './http-runner-execution';
const SHA = {
  definition: `sha256:${'1'.repeat(64)}`,
  prompt: `sha256:${'2'.repeat(64)}`,
  runtime: `sha256:${'3'.repeat(64)}`,
  task: `sha256:${'4'.repeat(64)}`,
  resultContract: `sha256:${'5'.repeat(64)}`,
  result: `sha256:${'6'.repeat(64)}`,
  artifact: `sha256:${'7'.repeat(64)}`,
} as const;

async function plannedApi(): Promise<HttpRunnerExecutionModule> {
  return (await import(plannedModulePath)) as HttpRunnerExecutionModule;
}

function envelope(): SealedRunnerEnvelope {
  return {
    schemaVersion: 1,
    runId: 'agent-run:writing-42',
    specialization: 'writing',
    birth: {
      definitionRef: 'writing-agent@1',
      definitionHash: SHA.definition,
      promptHash: SHA.prompt,
      runtimeHash: SHA.runtime,
      taskContractHash: SHA.task,
      resultContractHash: SHA.resultContract,
    },
    task: {
      contractRef: 'writing-task@1',
      payload: { objective: 'Produce the bounded document.', sourceBytes: 'immutable' },
      contextRefs: ['entity:brief-42', 'artifact:source-42'],
    },
    execution: {
      profileId: 'writing-host',
      backend: 'trusted-host',
      image: `registry.internal/ui4a/agent-runner@sha256:${'a'.repeat(64)}`,
      workspace: { rootRef: '/srv/ui4a/writing', retention: 'until-human-decision' },
      resources: { cpu: '1', memory: '1Gi', timeoutSeconds: 900 },
      networkPolicy: 'restricted',
      credentialRefs: ['writing-provider-token'],
      leaseId: 'lease:writing-42',
      issuedAt: '2026-08-24T12:00:00.000Z',
    },
  };
}

function runnerResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const delivery = envelope();
  return {
    schemaVersion: 1,
    deliveryId: 'delivery-writing-42',
    runId: delivery.runId,
    birth: delivery.birth,
    specialization: delivery.specialization,
    status: 'succeeded',
    resultHash: SHA.result,
    candidate: { markdown: '# Bounded result' },
    artifacts: [{ ref: 'artifact:writing-result', hash: SHA.artifact }],
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function port(
  fetchImpl: typeof fetch,
  overrides: Partial<{
    origin: string;
    authorizationHeader: string;
    timeoutMs: number;
  }> = {},
): Promise<RuntimeBackendExecutionPort> {
  const { createHttpRunnerExecutionPort } = await plannedApi();
  return createHttpRunnerExecutionPort({
    origin: 'https://runner.ui4a.internal',
    authorizationHeader: 'Bearer runner-token-sensitive',
    fetchImpl,
    timeoutMs: 5_000,
    ...overrides,
  });
}

describe('T22 authenticated HTTP Runner execution port', () => {
  it('posts one complete sealed delivery to the exact canonical /deliver endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(runnerResult())) as unknown as typeof fetch;
    const executionPort = await port(fetchImpl);
    const delivery = envelope() as SealedRunnerEnvelope & Record<string, unknown>;
    delivery.provider = 'request-provider-must-not-cross-wire';
    delivery.secret = 'request-secret-must-not-cross-wire';
    const heartbeat = vi.fn();

    await expect(
      executionPort.execute({
        envelope: delivery,
        handle: 'delivery-writing-42',
        signal: new AbortController().signal,
        heartbeat,
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      backendOutput: runnerResult(),
      transport: { status: 200 },
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(String(url)).toBe('https://runner.ui4a.internal/deliver');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer runner-token-sensitive',
        'content-type': 'application/json',
      },
    });
    const body = String(init?.body);
    const expectedWire = {
      schemaVersion: 1,
      deliveryId: 'delivery-writing-42',
      request: {
        schemaVersion: 1,
        runId: envelope().runId,
        specialization: envelope().specialization,
        birth: envelope().birth,
        task: envelope().task,
      },
      execution: {
        profileId: envelope().execution.profileId,
        backend: envelope().execution.backend,
        image: envelope().execution.image,
        workspace: { rootRef: envelope().execution.workspace.rootRef },
        resources: {
          cpu: envelope().execution.resources.cpu,
          memory: envelope().execution.resources.memory,
          timeoutMs: envelope().execution.resources.timeoutSeconds * 1_000,
        },
        networkPolicy: envelope().execution.networkPolicy,
        credentialRefs: ['writing-provider-token'],
      },
    } satisfies RunnerDeliveryWire;
    expect(JSON.parse(body)).toEqual(expectedWire);
    expect(body).not.toContain('runner-token-sensitive');
    expect(body).not.toContain('authorization');
    expect(body).not.toContain('request-provider-must-not-cross-wire');
    expect(body).not.toContain('request-secret-must-not-cross-wire');
    expect(heartbeat).toHaveBeenCalledOnce();
  });

  it('collects candidate and artifacts only from an output verified by this port', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(runnerResult())) as unknown as typeof fetch;
    const executionPort = await port(fetchImpl);
    const execution = await executionPort.execute({
      envelope: envelope(),
      handle: 'delivery-writing-42',
      signal: new AbortController().signal,
      heartbeat: vi.fn(),
    });

    await expect(executionPort.collect({ envelope: envelope(), execution })).resolves.toEqual({
      candidate: { markdown: '# Bounded result' },
      artifacts: [{ ref: 'artifact:writing-result', hash: SHA.artifact }],
    });
    await expect(
      executionPort.collect({
        envelope: envelope(),
        execution: { status: 'completed', backendOutput: runnerResult() },
      }),
    ).rejects.toThrow('runtime_http_result_unverified');
  });

  it.each([
    'http://runner.ui4a.internal',
    'https://runner.ui4a.internal/base',
    'https://runner.ui4a.internal?query=1',
    'https://runner.ui4a.internal#fragment',
    'https://user:pass@runner.ui4a.internal',
  ])('rejects non-canonical or non-HTTPS origin %s before fetch', async (origin) => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(port(fetchImpl, { origin })).rejects.toThrow('runtime_http_origin_invalid');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['Basic abc', 'Bearer ', 'Bearer token\nforged', 'bearer token'])(
    'rejects unsafe authorization header %s without exposing it',
    async (authorizationHeader) => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      await expect(port(fetchImpl, { authorizationHeader })).rejects.toThrow(
        'runtime_http_authorization_invalid',
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['runId', 'foreign-run'],
    ['deliveryId', 'foreign-delivery'],
    ['specialization', 'coding'],
    ['birth', { ...envelope().birth, runtimeHash: SHA.result }],
    ['resultHash', 'sha256:not-a-digest'],
    ['artifacts', [{ ref: 'artifact:writing-result', hash: 'invalid' }]],
    ['status', 'completed'],
    ['unknown', true],
  ] as const)('rejects invalid exact result field %s', async (field, value) => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(runnerResult({ [field]: value })),
    ) as unknown as typeof fetch;
    const executionPort = await port(fetchImpl);

    await expect(
      executionPort.execute({
        envelope: envelope(),
        handle: 'delivery-writing-42',
        signal: new AbortController().signal,
        heartbeat: vi.fn(),
      }),
    ).rejects.toThrow('runtime_http_result_invalid');
  });

  it('maps non-success status to a stable error without reading or echoing response body', async () => {
    const bodySpy = vi.fn(async () => 'server leaked runner-token-sensitive');
    const response = {
      ok: false,
      status: 503,
      text: bodySpy,
      json: vi.fn(),
    } as unknown as Response;
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
    const executionPort = await port(fetchImpl);

    await expect(
      executionPort.execute({
        envelope: envelope(),
        handle: 'delivery-writing-42',
        signal: new AbortController().signal,
        heartbeat: vi.fn(),
      }),
    ).rejects.toMatchObject({ message: 'runtime_http_status:503' });
    expect(bodySpy).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('honors caller cancellation with a stable error and the same fetch signal', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), {
          once: true,
        });
      });
    }) as unknown as typeof fetch;
    const executionPort = await port(fetchImpl);
    const controller = new AbortController();
    const pending = executionPort.execute({
      envelope: envelope(),
      handle: 'delivery-writing-42',
      signal: controller.signal,
      heartbeat: vi.fn(),
    });
    controller.abort(new Error('sensitive caller reason'));

    await expect(pending).rejects.toThrow('runtime_http_cancelled');
    expect(observedSignal?.aborted).toBe(true);
  });

  it('enforces its own timeout and returns a stable error', async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }) as unknown as typeof fetch;
    const executionPort = await port(fetchImpl, { timeoutMs: 5 });

    await expect(
      executionPort.execute({
        envelope: envelope(),
        handle: 'delivery-writing-42',
        signal: new AbortController().signal,
        heartbeat: vi.fn(),
      }),
    ).rejects.toThrow('runtime_http_timeout');
  });

  it('maps fetch and JSON failures to stable errors without echoing their messages', async () => {
    const unavailable = await port(
      vi.fn(async () => {
        throw new Error('runner-token-sensitive network detail');
      }) as unknown as typeof fetch,
    );
    await expect(
      unavailable.execute({
        envelope: envelope(),
        handle: 'delivery-writing-42',
        signal: new AbortController().signal,
        heartbeat: vi.fn(),
      }),
    ).rejects.toThrow('runtime_http_unavailable');

    const invalidJson = await port(
      vi.fn(async () => new Response('{not-json', { status: 200 })) as unknown as typeof fetch,
    );
    await expect(
      invalidJson.execute({
        envelope: envelope(),
        handle: 'delivery-writing-42',
        signal: new AbortController().signal,
        heartbeat: vi.fn(),
      }),
    ).rejects.toThrow('runtime_http_result_invalid');
  });
});
