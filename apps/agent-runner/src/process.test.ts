import { describe, expect, it, vi } from 'vitest';

type Specialization = 'coding' | 'writing' | 'authoring';

interface RunnerDelivery {
  schemaVersion: 1;
  deliveryId: string;
  request: {
    schemaVersion: 1;
    runId: string;
    specialization: Specialization;
    birth: {
      definitionRef: string;
      definitionHash: string;
      promptHash: string;
      runtimeHash: string;
      taskContractHash: string;
      resultContractHash: string;
    };
    task: { contractRef: string; payload: unknown; contextRefs: string[] };
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

interface RunnerDeliveryResult {
  schemaVersion: 1;
  deliveryId: string;
  runId: string;
  specialization: Specialization;
  status: 'succeeded';
  birth: RunnerDelivery['request']['birth'];
  candidate: unknown;
  artifacts: Array<{ ref: string; hash: string }>;
  resultHash: string;
}

interface RunnerDeliveryProcessor {
  execute(delivery: unknown, options?: { signal?: AbortSignal }): Promise<RunnerDeliveryResult>;
}

interface ProcessModule {
  createRunnerDeliveryProcessor(dependencies: {
    resolveSecrets(refs: string[]): Promise<Record<string, string>>;
    executor(
      delivery: RunnerDelivery,
      context: { signal: AbortSignal; secrets: Readonly<Record<string, string>> },
    ): Promise<{
      candidate: unknown;
      artifacts: Array<{ ref: string; hash: string }>;
      transport?: unknown;
    }>;
    scheduleTimeout(timeoutMs: number, onTimeout: () => void): () => void;
  }): RunnerDeliveryProcessor;
}

const plannedModulePath = './process';

async function processApi(): Promise<ProcessModule> {
  return (await import(plannedModulePath)) as ProcessModule;
}

function delivery(specialization: Specialization = 'coding'): RunnerDelivery {
  return {
    schemaVersion: 1,
    deliveryId: `delivery:${specialization}:1`,
    request: {
      schemaVersion: 1,
      runId: `run:${specialization}:1`,
      specialization,
      birth: {
        definitionRef: `${specialization}-agent@1`,
        definitionHash: `sha256:${'1'.repeat(64)}`,
        promptHash: `sha256:${'2'.repeat(64)}`,
        runtimeHash: `sha256:${'3'.repeat(64)}`,
        taskContractHash: `sha256:${'4'.repeat(64)}`,
        resultContractHash: `sha256:${'5'.repeat(64)}`,
      },
      task: {
        contractRef: `${specialization}-task@1`,
        payload: { instruction: `perform ${specialization}` },
        contextRefs: ['entity:fixture'],
      },
    },
    execution: {
      profileId: `server-${specialization}`,
      backend: 'kubernetes-job',
      image: `registry.internal/ui4a/agent-runner@sha256:${'a'.repeat(64)}`,
      workspace: { rootRef: `workspace:${specialization}:1` },
      resources: { cpu: '1', memory: '1Gi', timeoutMs: 30_000 },
      networkPolicy: 'restricted',
      credentialRefs: ['provider-token'],
    },
  };
}

function dependencies(overrides: Partial<Parameters<ProcessModule['createRunnerDeliveryProcessor']>[0]> = {}) {
  return {
    resolveSecrets: vi.fn(async () => ({ 'provider-token': '__runner_secret__' })),
    executor: vi.fn(async () => ({
      candidate: { status: 'completed' },
      artifacts: [{ ref: 'artifact:result', hash: `sha256:${'b'.repeat(64)}` }],
      transport: { podName: 'transport-only' },
    })),
    scheduleTimeout: vi.fn(() => () => undefined),
    ...overrides,
  };
}

describe('Agent Runner common delivery process', () => {
  it('passes server-resolved Secrets only to the executor and emits a canonical result', async () => {
    const { createRunnerDeliveryProcessor } = await processApi();
    const deps = dependencies();
    const input = delivery();
    const processor = createRunnerDeliveryProcessor(deps);

    const result = await processor.execute(input);

    expect(deps.resolveSecrets).toHaveBeenCalledWith(['provider-token']);
    expect(deps.executor).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: input.deliveryId, execution: input.execution }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        secrets: { 'provider-token': '__runner_secret__' },
      }),
    );
    expect(result).toMatchObject({
      schemaVersion: 1,
      deliveryId: input.deliveryId,
      runId: input.request.runId,
      specialization: 'coding',
      status: 'succeeded',
      birth: input.request.birth,
      candidate: { status: 'completed' },
      artifacts: [{ ref: 'artifact:result', hash: `sha256:${'b'.repeat(64)}` }],
      resultHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(result)).not.toContain('__runner_secret__');
    expect(JSON.stringify(result)).not.toContain('transport-only');
  });

  it.each([
    'provider',
    'model',
    'cwd',
    'env',
    'backend',
    'image',
    'workspace',
    'resources',
    'networkPolicy',
  ])('rejects request-controlled %s before Secret resolution or executor mutation', async (field) => {
    const { createRunnerDeliveryProcessor } = await processApi();
    const deps = dependencies();
    const input = delivery() as RunnerDelivery & { request: Record<string, unknown> };
    input.request[field] = 'request-controlled';

    await expect(createRunnerDeliveryProcessor(deps).execute(input)).rejects.toThrow(
      `runner_request_forbidden_field:${field}`,
    );
    expect(deps.resolveSecrets).not.toHaveBeenCalled();
    expect(deps.executor).not.toHaveBeenCalled();
    expect(deps.scheduleTimeout).not.toHaveBeenCalled();
  });

  it('deduplicates identical concurrent and completed delivery while rejecting id conflict', async () => {
    const { createRunnerDeliveryProcessor } = await processApi();
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = dependencies({
      executor: vi.fn(async () => {
        await blocked;
        return {
          candidate: { status: 'completed' },
          artifacts: [{ ref: 'artifact:result', hash: `sha256:${'b'.repeat(64)}` }],
        };
      }),
    });
    const processor = createRunnerDeliveryProcessor(deps);
    const input = delivery();

    const first = processor.execute(input);
    const duplicate = processor.execute(structuredClone(input));
    release?.();
    await expect(duplicate).resolves.toEqual(await first);
    await expect(processor.execute(structuredClone(input))).resolves.toEqual(await first);
    expect(deps.executor).toHaveBeenCalledOnce();

    const conflict = structuredClone(input);
    conflict.request.task.payload = { instruction: 'different' };
    await expect(processor.execute(conflict)).rejects.toThrow('runner_delivery_conflict');
    expect(deps.executor).toHaveBeenCalledOnce();
  });

  it('normalizes executor errors and rejects Secret-bearing results without disclosure', async () => {
    const { createRunnerDeliveryProcessor } = await processApi();
    for (const executor of [
      vi.fn(async () => {
        throw new Error('provider failed with __runner_secret__');
      }),
      vi.fn(async () => ({
        candidate: { leaked: '__runner_secret__' },
        artifacts: [],
      })),
    ]) {
      const processor = createRunnerDeliveryProcessor(dependencies({ executor }));
      let error: unknown;
      try {
        await processor.execute(delivery());
      } catch (caught) {
        error = caught;
      }
      expect(error).toEqual(expect.objectContaining({ message: 'runner_execution_failed' }));
      expect(String(error)).not.toContain('__runner_secret__');
    }
  });

  it('propagates injected cancellation as a stable terminal error', async () => {
    const { createRunnerDeliveryProcessor } = await processApi();
    const controller = new AbortController();
    controller.abort();
    const deps = dependencies();

    await expect(
      createRunnerDeliveryProcessor(deps).execute(delivery(), { signal: controller.signal }),
    ).rejects.toThrow('runner_execution_cancelled');
    expect(deps.resolveSecrets).not.toHaveBeenCalled();
    expect(deps.executor).not.toHaveBeenCalled();
  });

  it('uses the injected timeout boundary and aborts the executor without leaking its error', async () => {
    const { createRunnerDeliveryProcessor } = await processApi();
    let expire: (() => void) | undefined;
    const dispose = vi.fn();
    const deps = dependencies({
      scheduleTimeout: vi.fn((_timeoutMs, onTimeout) => {
        expire = onTimeout;
        return dispose;
      }),
      executor: vi.fn(
        async (_delivery, context) =>
          new Promise<never>((_resolve, reject) => {
            context.signal.addEventListener(
              'abort',
              () => reject(new Error('timeout with __runner_secret__')),
              { once: true },
            );
          }),
      ),
    });
    const pending = createRunnerDeliveryProcessor(deps).execute(delivery());
    await vi.waitFor(() => expect(expire).toBeTypeOf('function'));
    expire?.();

    await expect(pending).rejects.toThrow('runner_execution_timeout');
    expect(deps.scheduleTimeout).toHaveBeenCalledWith(30_000, expect.any(Function));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it.each(['coding', 'writing', 'authoring'] as const)(
    'uses the same specialization-neutral executor for %s',
    async (specialization) => {
      const { createRunnerDeliveryProcessor } = await processApi();
      const deps = dependencies();

      const result = await createRunnerDeliveryProcessor(deps).execute(delivery(specialization));

      expect(result.specialization).toBe(specialization);
      expect(deps.executor).toHaveBeenCalledOnce();
    },
  );
});
