import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const RUNNER_COMPONENT = 'ui4a-agent-runner';

export interface ReleaseMetadata {
  component: typeof RUNNER_COMPONENT;
  version: string;
  gitSha: string;
  buildDate: string;
  channel: 'experimental';
}

export function releaseMetadata(environment: NodeJS.ProcessEnv = process.env): ReleaseMetadata {
  return {
    component: RUNNER_COMPONENT,
    version: environment.UI4A_VERSION ?? 'v0.1.0-experimental.1-dev',
    gitSha: environment.UI4A_GIT_SHA ?? 'unknown',
    buildDate: environment.UI4A_BUILD_DATE ?? 'unknown',
    channel: 'experimental',
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

export async function runDaemon(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const port = Number(environment.UI4A_RUNNER_PORT ?? 3102);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('UI4A_RUNNER_PORT must be an integer from 1 to 65535');
  }

  const server = createServer((request, response) =>
    handleRunnerRequest(request, response, environment),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  console.log(
    JSON.stringify({
      event: 'runner-started',
      mode: 'daemon',
      port,
      release: releaseMetadata(environment),
    }),
  );

  const close = (): void => {
    server.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await new Promise<void>((resolve, reject) => {
    server.once('close', resolve);
    server.once('error', reject);
  });
}

export function unavailableOneshotMessage(): string {
  return 'oneshot delivery is unavailable until the Phase F Runtime Backend contract is active';
}
