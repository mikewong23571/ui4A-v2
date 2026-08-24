import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

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

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(value)}\n`);
}

export function handleRunnerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (request.method === 'GET' && request.url === '/live') {
    writeJson(response, 200, runnerLivePayload(environment));
    return;
  }
  if (request.method === 'GET' && request.url === '/version') {
    writeJson(response, 200, releaseMetadata(environment));
    return;
  }
  writeJson(response, 404, { status: 'not-found' });
}

export interface RunnerDaemonOptions {
  host?: string;
  signal?: AbortSignal;
  write?: (line: string) => void;
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

  const server = createServer((request, response) =>
    handleRunnerRequest(request, response, environment),
  );
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
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
    if (closing || !server.listening) {
      return;
    }
    closing = true;
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

export function unavailableOneshotMessage(): string {
  return 'oneshot delivery is unavailable until the Phase F Runtime Backend contract is active';
}
