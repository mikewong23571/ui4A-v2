import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from './args.js';
import { HELP, runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { redact } from './envelope.js';
import { Ui4aHttpClient } from './http.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ui4a CLI contract', () => {
  it('documents composable resources and omits approval commands', () => {
    expect(HELP).toContain('apps list');
    expect(HELP).toContain('drafts create');
    expect(HELP).toContain('request get|head');
    expect(HELP).not.toMatch(/activations approve/);
  });

  it('rejects identity and Draft bypass flags', () => {
    for (const flag of ['--actor', '--principal', '--no-draft']) {
      expect(() => parseArgs(['actions', 'list', 'x', flag, 'human'])).toThrow('server-owned');
    }
  });

  it('uses flag then env then config/default precedence without printing token', async () => {
    const config = await loadConfig(
      { baseUrl: 'http://flag.example', token: 'flag-secret', configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'http://env.example', UI4A_TOKEN: 'env-secret' },
    );
    expect(config.baseUrl).toBe('http://flag.example');
    expect(config.sources).toMatchObject({ baseUrl: 'flag', token: 'flag' });
    expect(
      JSON.stringify(redact({ token: config.token, nested: { authorization: 'x' } })),
    ).not.toContain('secret');
  });

  it('doctor is successful without auth and reports local-demo honestly', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/health') return response({ status: 'ok' });
      return response({ protocolVersion: '1', version: 'abc', applications: [], flows: [] });
    });
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});
    const result = await runCommand(
      parseArgs(['--json', 'doctor']),
      new Ui4aHttpClient(config, fetcher),
    );
    expect(result).toMatchObject({ ok: true, command: 'doctor', meta: { protocolVersion: '1' } });
    expect(result.data).toMatchObject({
      auth: { mode: 'self-reported-local-demo', configured: false },
    });
  });

  it('doctor returns a network failure when every protocol endpoint is unreachable', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error('connection refused');
    });
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});
    await expect(
      runCommand(parseArgs(['--json', 'doctor']), new Ui4aHttpClient(config, fetcher)),
    ).rejects.toMatchObject({ code: 'NETWORK', exitCode: 8, retryable: true });
  });

  it('actions dry-run follows live Siren and performs no write', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({
        properties: { rel: 'post:first' },
        actions: [{ name: 'unpublish', href: '/api/exec', fields: { type: 'object' } }],
      }),
    );
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});
    const result = await runCommand(
      parseArgs(['actions', 'exec', 'post:first', 'unpublish', '--params', '{}', '--dry-run']),
      new Ui4aHttpClient(config, fetcher),
    );
    expect(result.data).toMatchObject({ dryRun: true, effect: 'not executed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('raw request rejects writes and cross-origin targets', async () => {
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});
    const client = new Ui4aHttpClient(config, vi.fn<typeof fetch>());
    await expect(client.request('/api/exec', { method: 'POST', rawRead: true })).rejects.toThrow(
      'GET and HEAD',
    );
    await expect(client.request('https://outside.example/data', { rawRead: true })).rejects.toThrow(
      'cross-origin',
    );
  });
});
