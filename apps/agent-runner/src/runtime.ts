import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { aggregateReadiness, type ReadinessLifecycle } from '@ui4a/shared';

import { executeRunnerDelivery, type RunnerDeliveryProcessor } from './process.js';

export const RUNNER_COMPONENT = 'ui4a-agent-runner';
const RUNNER_VERSION = '0.1.0-experimental.1' as const;
const RUNNER_TAG = `v${RUNNER_VERSION}` as const;

export function releaseMetadata(environment: NodeJS.ProcessEnv = process.env) {
  const injectedVersion = environment.UI4A_VERSION?.trim();
  if (injectedVersion !== undefined && injectedVersion !== RUNNER_VERSION) {
    throw new Error(`UI4A_VERSION must match canonical release ${RUNNER_VERSION}`);
  }
  return {
    component: RUNNER_COMPONENT,
    version: RUNNER_VERSION,
    tag: RUNNER_TAG,
    channel: 'experimental' as const,
    support: {
      ga: false,
      productionReady: false,
      sla: false,
      lts: false,
    } as const,
    gitSha: environment.UI4A_GIT_SHA?.trim() || 'unknown',
    buildDate: environment.UI4A_BUILD_DATE?.trim() || 'unknown',
  };
}

export function runnerLivePayload(environment: NodeJS.ProcessEnv = process.env) {
  return {
    status: 'live' as const,
    mode: 'daemon' as const,
    release: releaseMetadata(environment),
  };
}

export interface RunnerBackendReadiness {
  registered: boolean;
  deliveryAvailable: boolean;
}

export interface RunnerReadinessState extends RunnerBackendReadiness {
  lifecycle: ReadinessLifecycle;
}

export type RunnerBackendReadinessProvider = () => RunnerBackendReadiness;
type RunnerReadinessProvider = () => RunnerReadinessState;
export type RunnerDeliveryAuthorizer = (request: IncomingMessage) => boolean | Promise<boolean>;

const UNAVAILABLE_BACKEND: RunnerBackendReadiness = Object.freeze({
  registered: false,
  deliveryAvailable: false,
});

function readinessErrorCode(state: RunnerReadinessState): string {
  if (state.lifecycle === 'starting') return 'process_starting';
  if (state.lifecycle === 'draining') return 'process_draining';
  if (!state.registered) return 'runtime_backend_unavailable';
  return 'runtime_delivery_unavailable';
}

export function runnerReadyPayload(state: RunnerReadinessState) {
  const readiness = aggregateReadiness({
    component: RUNNER_COMPONENT,
    lifecycle: state.lifecycle,
    dependencies: {
      registration: state.registered
        ? { required: true, status: 'ok' }
        : {
            required: true,
            status: 'error',
            reasonCode: 'runtime_backend_unavailable',
          },
      delivery: state.deliveryAvailable
        ? { required: true, status: 'ok' }
        : {
            required: true,
            status: 'error',
            reasonCode: 'runtime_delivery_unavailable',
          },
    },
  });
  return readiness.status === 'ready'
    ? readiness
    : { ...readiness, error: { code: readinessErrorCode(state) } };
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(value)}\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 1024 * 1024) throw new Error('runner_delivery_too_large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new Error('runner_delivery_invalid_json');
  }
}

function publicDeliveryError(error: unknown): { status: number; reasonCode: string } {
  const reasonCode = error instanceof Error ? error.message : 'runner_execution_failed';
  if (reasonCode === 'runner_delivery_conflict') return { status: 409, reasonCode };
  if (reasonCode === 'runner_execution_timeout') return { status: 504, reasonCode };
  if (reasonCode === 'runner_execution_cancelled') return { status: 409, reasonCode };
  if (
    reasonCode === 'runner_delivery_invalid' ||
    reasonCode === 'runner_delivery_invalid_json' ||
    reasonCode === 'runner_delivery_too_large' ||
    reasonCode.startsWith('runner_request_forbidden_field:')
  ) {
    return { status: 400, reasonCode };
  }
  return { status: 502, reasonCode: 'runner_execution_failed' };
}

export async function handleRunnerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  environment: NodeJS.ProcessEnv = process.env,
  readiness: RunnerReadinessProvider = () => ({
    lifecycle: 'serving',
    ...UNAVAILABLE_BACKEND,
  }),
  deliveryProcessor?: RunnerDeliveryProcessor,
  authorizeDelivery?: RunnerDeliveryAuthorizer,
): Promise<void> {
  if (request.method === 'GET' && request.url === '/live') {
    writeJson(response, 200, runnerLivePayload(environment));
    return;
  }
  if (request.method === 'GET' && request.url === '/version') {
    writeJson(response, 200, releaseMetadata(environment));
    return;
  }
  if (request.method === 'GET' && request.url === '/ready') {
    let state: RunnerReadinessState;
    try {
      state = readiness();
    } catch {
      state = { lifecycle: 'serving', ...UNAVAILABLE_BACKEND };
    }
    const payload = runnerReadyPayload(state);
    writeJson(response, payload.status === 'ready' ? 200 : 503, payload);
    return;
  }
  if (request.method === 'POST' && request.url === '/deliver') {
    if (deliveryProcessor === undefined || authorizeDelivery === undefined) {
      writeJson(response, 503, {
        status: 'unavailable',
        reasonCode: 'runner_delivery_not_configured',
      });
      return;
    }
    let authorized = false;
    try {
      authorized = await authorizeDelivery(request);
    } catch {
      // Authentication adapters fail closed without exposing credential details.
    }
    if (!authorized) {
      writeJson(response, 401, {
        status: 'failed',
        reasonCode: 'runner_delivery_unauthorized',
      });
      return;
    }
    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    request.once('aborted', cancel);
    try {
      const result = await executeRunnerDelivery(deliveryProcessor, await readJsonBody(request), {
        signal: controller.signal,
      });
      writeJson(response, 200, result);
    } catch (error) {
      const failure = publicDeliveryError(error);
      writeJson(response, failure.status, { status: 'failed', reasonCode: failure.reasonCode });
    } finally {
      request.off('aborted', cancel);
    }
    return;
  }
  writeJson(response, 404, { status: 'not-found' });
}

export interface RunnerDaemonOptions {
  host?: string;
  signal?: AbortSignal;
  write?: (line: string) => void;
  backendReadiness?: RunnerBackendReadinessProvider;
  deliveryProcessor?: RunnerDeliveryProcessor;
  authorizeDelivery?: RunnerDeliveryAuthorizer;
}

export function runnerPort(environment: NodeJS.ProcessEnv = process.env): number {
  const port = Number(environment.UI4A_RUNNER_PORT ?? 3102);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('UI4A_RUNNER_PORT must be an integer from 1 to 65535');
  }
  return port;
}

export async function runDaemon(
  environment: NodeJS.ProcessEnv = process.env,
  options: RunnerDaemonOptions = {},
): Promise<void> {
  const port = runnerPort(environment);
  const host = options.host ?? '0.0.0.0';
  const write = options.write ?? ((line: string) => console.log(line));
  const release = releaseMetadata(environment);
  const backendReadiness =
    options.backendReadiness ??
    (options.deliveryProcessor === undefined || options.authorizeDelivery === undefined
      ? () => UNAVAILABLE_BACKEND
      : () => ({ registered: true, deliveryAvailable: true }));
  let lifecycle: ReadinessLifecycle = 'starting';
  const readiness = (): RunnerReadinessState => {
    let backend = UNAVAILABLE_BACKEND;
    try {
      backend = backendReadiness();
    } catch {
      // Dependency adapters fail closed without exposing exception text or credentials.
    }
    return { lifecycle, ...backend };
  };

  const server = createServer((request, response) => {
    void handleRunnerRequest(
      request,
      response,
      environment,
      readiness,
      options.deliveryProcessor,
      options.authorizeDelivery,
    );
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      lifecycle = 'serving';
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  write(
    JSON.stringify({
      event: 'runner-started',
      mode: 'daemon',
      port,
      release,
    }),
  );

  let rejectClose: (error: Error) => void = () => undefined;
  const closed = new Promise<void>((resolve, reject) => {
    rejectClose = reject;
    server.once('close', resolve);
    server.once('error', reject);
  });
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    lifecycle = 'draining';
    if (!server.listening) return;
    server.close((error) => {
      if (error !== undefined) {
        rejectClose(error);
      }
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  options.signal?.addEventListener('abort', close, { once: true });
  if (options.signal?.aborted === true) {
    close();
  }
  try {
    await closed;
  } finally {
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
    options.signal?.removeEventListener('abort', close);
  }
}
