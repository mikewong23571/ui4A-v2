import { createServer, type RequestListener, type Server } from 'node:http';

import { releaseMetadata, type DeploymentEnvironment } from '@ui4a/shared';

export const WORKER_COMPONENT = 'ui4a-worker';

export function workerReleaseMetadata(environment: DeploymentEnvironment = process.env) {
  return releaseMetadata(WORKER_COMPONENT, environment);
}

export function workerLivePayload(environment: DeploymentEnvironment = process.env) {
  return { status: 'live' as const, release: workerReleaseMetadata(environment) };
}

export function createWorkerHealthHandler(
  environment: DeploymentEnvironment = process.env,
): RequestListener {
  return (request, response) => {
    if (request.method !== 'GET' || !['/live', '/version'].includes(request.url ?? '')) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end('{"status":"not-found"}\n');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(
      `${JSON.stringify(request.url === '/version' ? workerReleaseMetadata(environment) : workerLivePayload(environment))}\n`,
    );
  };
}

export async function startWorkerHealthServer(
  environment: DeploymentEnvironment = process.env,
): Promise<Server> {
  const port = Number(environment.UI4A_WORKER_HEALTH_PORT ?? 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('UI4A_WORKER_HEALTH_PORT must be an integer from 1 to 65535');
  }
  const server = createServer(createWorkerHealthHandler(environment));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  return server;
}
