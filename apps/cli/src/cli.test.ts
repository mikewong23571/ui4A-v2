import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from './args.js';
import { HELP, runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { redact } from './envelope.js';
import { Ui4aHttpClient } from './http.js';
import { CLI_RELEASE_CHANNEL, CLI_RELEASE_TAG, CLI_VERSION, cliVersionLine } from './release.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ui4a CLI contract', () => {
  it('reports the canonical experimental identity without loading endpoint config', () => {
    expect(parseArgs(['--version'])).toMatchObject({ version: true, words: [] });
    expect(CLI_VERSION).toBe('0.1.0-experimental.1');
    expect(CLI_RELEASE_TAG).toBe('v0.1.0-experimental.1');
    expect(CLI_RELEASE_CHANNEL).toBe('experimental');
    expect(cliVersionLine()).toBe('ui4a v0.1.0-experimental.1 (experimental)');
  });

  it('documents composable resources and omits approval commands', () => {
    expect(HELP).toContain('auth login|status|logout');
    expect(HELP).toContain('apps list');
    expect(HELP).toContain('drafts create');
    expect(HELP).toContain('[--scope APPLICATION]');
    expect(HELP).toContain('request get|head');
    expect(HELP).not.toMatch(/activations approve/);
  });

  it('loads production Device endpoints and applications without treating them as identity', async () => {
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      {
        UI4A_BASE_URL: 'https://ui4a.example',
        UI4A_ISSUER: 'https://auth.ui4a.example/realms/ui4a',
        UI4A_CLIENT_ID: 'ui4a-cli',
        UI4A_APPLICATIONS: 'development,governance',
      },
    );
    expect(config).toMatchObject({
      issuer: 'https://auth.ui4a.example/realms/ui4a',
      clientId: 'ui4a-cli',
      applications: ['development', 'governance'],
    });
    expect(config.sources).toMatchObject({
      issuer: 'env',
      clientId: 'env',
      applications: 'env',
      token: 'missing',
    });
  });

  it('rejects identity and Draft bypass flags', () => {
    for (const flag of ['--actor', '--principal', '--no-draft']) {
      expect(() => parseArgs(['actions', 'list', 'x', flag, 'human'])).toThrow('server-owned');
    }
  });

  it('uses flag then env then config/default precedence without printing token', async () => {
    const config = await loadConfig(
      { baseUrl: 'https://flag.example', token: 'flag-secret', configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://env.example', UI4A_TOKEN: 'env-secret' },
    );
    expect(config.baseUrl).toBe('https://flag.example');
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
