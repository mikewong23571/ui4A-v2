import { createServer, type Server } from 'node:http';

export function workerReleaseMetadata(environment: NodeJS.ProcessEnv = process.env) {
  return {
    component: 'ui4a-worker' as const,
    version: environment.UI4A_VERSION ?? 'v0.1.0-experimental.1-dev',
    gitSha: environment.UI4A_GIT_SHA ?? 'unknown',
    buildDate: environment.UI4A_BUILD_DATE ?? 'unknown',
    channel: 'experimental' as const,
  };
}

export function workerLivePayload(environment: NodeJS.ProcessEnv = process.env) {
  return { status: 'live' as const, release: workerReleaseMetadata(environment) };
}

export async function startWorkerHealthServer(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Server> {
  const port = Number(environment.UI4A_WORKER_HEALTH_PORT ?? 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('UI4A_WORKER_HEALTH_PORT must be an integer from 1 to 65535');
  }
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/live') {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{"status":"not-found"}\n');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(`${JSON.stringify(workerLivePayload(environment))}\n`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  return server;
}
