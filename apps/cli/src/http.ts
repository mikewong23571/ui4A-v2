import type { CliConfig } from './config.js';
import { CliError } from './envelope.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;

function statusError(status: number, body: unknown): CliError {
  const message =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { error?: unknown }).error === 'string'
      ? String((body as { error: string }).error)
      : typeof body === 'object' &&
          body !== null &&
          typeof (body as { reason?: unknown }).reason === 'string'
        ? String((body as { reason: string }).reason)
        : `UI4A returned HTTP ${status}`;
  if (status === 401 || status === 403) return new CliError('AUTH', message, 4, status, body);
  if (status === 404) return new CliError('NOT_FOUND', message, 5, status, body);
  if (status === 409) return new CliError('CONFLICT', message, 7, status, body, true);
  if (status >= 500) return new CliError('SERVICE', message, 8, status, body, true);
  return new CliError('JUDGMENT', message, 6, status, body);
}

export class Ui4aHttpClient {
  constructor(
    readonly config: CliConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private headers(write: boolean): Headers {
    const headers = new Headers({
      accept: 'application/json',
    });
    if (write) headers.set('content-type', 'application/json');
    if (this.config.token !== undefined) {
      headers.set('authorization', `Bearer ${this.config.token}`);
    } else {
      headers.set('x-ui4a-principal', this.config.principal);
      headers.set('x-ui4a-policy-scope', this.config.policyScope);
    }
    return headers;
  }

  async request(
    path: string,
    options?: { method?: 'GET' | 'HEAD' | 'POST'; body?: unknown; rawRead?: boolean },
  ): Promise<{ data: unknown; status: number; headers: Headers }> {
    const method = options?.method ?? 'GET';
    const target = new URL(path, `${this.config.baseUrl}/`);
    if (target.origin !== new URL(this.config.baseUrl).origin) {
      throw new CliError('CROSS_ORIGIN', 'cross-origin request is forbidden', 2);
    }
    if (options?.rawRead === true && method !== 'GET' && method !== 'HEAD') {
      throw new CliError('RAW_WRITE_FORBIDDEN', 'raw request supports GET and HEAD only', 2);
    }
    let response: Response;
    try {
      response = await this.fetcher(target, {
        method,
        headers: this.headers(method === 'POST'),
        ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        redirect: options?.rawRead === true ? 'manual' : 'follow',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new CliError(
        'NETWORK',
        error instanceof Error ? error.message : String(error),
        8,
        undefined,
        undefined,
        true,
      );
    }
    if (options?.rawRead === true && response.status >= 300 && response.status < 400) {
      throw new CliError('REDIRECT', 'raw request redirect is forbidden', 8, response.status);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_RESPONSE_BYTES) {
      throw new CliError('RESPONSE_TOO_LARGE', 'response exceeds 1 MiB', 9, response.status);
    }
    const text = method === 'HEAD' ? '' : await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new CliError('RESPONSE_TOO_LARGE', 'response exceeds 1 MiB', 9, response.status);
    }
    let data: unknown = null;
    if (text !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        throw new CliError('PROTOCOL', 'response is not valid JSON', 9, response.status);
      }
    }
    if (!response.ok) throw statusError(response.status, data);
    return { data, status: response.status, headers: response.headers };
  }

  get(path: string) {
    return this.request(path);
  }

  post(path: string, body: unknown) {
    return this.request(path, { method: 'POST', body });
  }
}
