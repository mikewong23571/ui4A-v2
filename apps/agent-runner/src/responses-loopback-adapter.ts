import { Buffer } from 'node:buffer';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';

const loopbackHost = '127.0.0.1';
const loopbackPath = '/v1/responses';
const fixedUserAgent = 'ui4a-runner/0.1.0-experimental.1';
const maximumRequestBytes = 8 * 1024 * 1024;
const strippedHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export interface ResponsesLoopbackAdapter {
  baseUrl: string;
  close(): Promise<void>;
}

export interface ResponsesLoopbackAdapterOptions {
  upstreamBaseUrl: string;
  requestTimeoutMs: number;
  fetch?: typeof fetch;
}

function failConfig(): never {
  throw new Error('runner_responses_adapter_config_invalid');
}

function canonicalUpstream(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return failConfig();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/v1' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    failConfig();
  }
  return `${url.origin}/v1/responses`;
}

function copyRequestHeaders(input: IncomingHttpHeaders): Headers {
  const output = new Headers();
  for (const [name, value] of Object.entries(input)) {
    const normalizedName = name.toLowerCase();
    if (
      value === undefined ||
      strippedHeaders.has(normalizedName) ||
      normalizedName === 'user-agent'
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) output.append(name, entry);
    } else {
      output.set(name, value);
    }
  }
  output.set('user-agent', fixedUserAgent);
  return output;
}

function copyResponseHeaders(input: Headers, output: ServerResponse): void {
  input.forEach((value, name) => {
    if (!strippedHeaders.has(name.toLowerCase())) output.setHeader(name, value);
  });
}

function stableError(response: ServerResponse, status: number, code: string): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = JSON.stringify({ error: { code, type: 'adapter_error' } });
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readRequestBody(request: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value)
      ? value
      : typeof value === 'string'
        ? Buffer.from(value)
        : Buffer.from(value as Uint8Array);
    size += chunk.length;
    if (size > maximumRequestBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Start one loopback-only, canonical Responses transport for a bounded Runner execution. */
export async function startResponsesLoopbackAdapter(
  options: ResponsesLoopbackAdapterOptions,
): Promise<ResponsesLoopbackAdapter> {
  const upstreamUrl = canonicalUpstream(options.upstreamBaseUrl);
  if (
    !Number.isSafeInteger(options.requestTimeoutMs) ||
    options.requestTimeoutMs <= 0 ||
    options.requestTimeoutMs > 10 * 60_000
  ) {
    failConfig();
  }
  const fetchImplementation = options.fetch ?? fetch;
  const activeControllers = new Set<AbortController>();

  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== loopbackPath) {
        stableError(
          response,
          request.url === loopbackPath ? 405 : 404,
          'runner_responses_adapter_route_rejected',
        );
        return;
      }

      const controller = new AbortController();
      activeControllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs);
      timeout.unref();
      const abort = () => controller.abort();
      request.once('aborted', abort);
      response.once('close', () => {
        if (!response.writableEnded) abort();
      });
      try {
        const body = await readRequestBody(request);
        const upstream = await fetchImplementation(upstreamUrl, {
          method: 'POST',
          headers: copyRequestHeaders(request.headers),
          body,
          redirect: 'error',
          signal: controller.signal,
        });
        response.statusCode = upstream.status;
        copyResponseHeaders(upstream.headers, response);
        if (upstream.body !== null) {
          for await (const chunk of upstream.body) response.write(Buffer.from(chunk));
        }
        response.end();
      } catch (error) {
        stableError(
          response,
          error instanceof Error && error.message === 'request_too_large' ? 413 : 502,
          error instanceof Error && error.message === 'request_too_large'
            ? 'runner_responses_adapter_request_too_large'
            : 'runner_responses_adapter_upstream_failed',
        );
      } finally {
        clearTimeout(timeout);
        request.off('aborted', abort);
        activeControllers.delete(controller);
      }
    })();
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const reject = () => rejectPromise(new Error('runner_responses_adapter_listen_failed'));
    server.once('error', reject);
    server.listen(0, loopbackHost, () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string' || address.address !== loopbackHost) {
    server.close();
    return failConfig();
  }

  let closing: Promise<void> | undefined;
  return {
    baseUrl: `http://${loopbackHost}:${address.port}/v1`,
    close() {
      if (closing !== undefined) return closing;
      for (const controller of activeControllers) controller.abort();
      closing = new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
