import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from './args.js';
import { entityPath, metaExecPath } from './command-helpers.js';
import { runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { Ui4aHttpClient } from './http.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('D65 CLI explicit application lens', () => {
  it('accepts --scope as attention declaration while --policy-scope stays forbidden', () => {
    expect(parseArgs(['--scope', 'development', 'drafts', 'list']).scope).toBe('development');
    expect(() => parseArgs(['--policy-scope', 'development'])).toThrow('server-owned');
  });

  it('treats only operator declarations as a lens, never the local-demo default', async () => {
    const flagged = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      {},
    );
    expect(flagged.declaredScope).toBe('development');
    expect(flagged.policyScope).toBe('development');
    expect(flagged.sources.policyScope).toBe('flag');

    const fromEnv = await loadConfig(
      { configPath: '/definitely/missing' },
      { UI4A_POLICY_SCOPE: 'publishing' },
    );
    expect(fromEnv.declaredScope).toBe('publishing');
    expect(fromEnv.sources.policyScope).toBe('env');

    const undeclared = await loadConfig({ configPath: '/definitely/missing' }, {});
    expect(undeclared.declaredScope).toBeUndefined();
    expect(undeclared.policyScope).toBe('publishing');
    expect(undeclared.sources.policyScope).toBe('local-demo-default');
  });

  it('rejects a declared scope that is not an application identifier', async () => {
    await expect(
      loadConfig({ scope: 'Not An App', configPath: '/definitely/missing' }, {}),
    ).rejects.toMatchObject({ code: 'CONFIG', exitCode: 3 });
  });

  it('routes meta reads and meta writes through the declared lens query', async () => {
    const declared = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      {},
    );
    expect(entityPath('meta/drafts', declared)).toBe(
      '/_meta/api/entity?rel=meta%2Fdrafts&scope=development',
    );
    expect(entityPath('post:first', declared)).toBe('/api/entity?rel=post%3Afirst');
    expect(metaExecPath(declared)).toBe('/_meta/api/exec?scope=development');

    const undeclared = await loadConfig({ configPath: '/definitely/missing' }, {});
    expect(metaExecPath(undeclared)).toBe('/_meta/api/exec');
    expect(entityPath('meta/drafts', undeclared)).toBe(
      '/_meta/api/entity?rel=meta%2Fdrafts&policyScope=publishing',
    );
  });

  it('declares the lens on the Draft create request the server requires', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      urls.push(String(input));
      return response({ entity: { properties: { rel: 'draft:d1' } } });
    });
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: 'opaque-token' },
    );
    const result = await runCommand(
      parseArgs([
        'drafts',
        'create',
        '--kind',
        'flow-definition',
        '--target',
        'post-status',
        '--payload',
        '{"name":"post-status"}',
      ]),
      new Ui4aHttpClient(config, fetcher),
    );
    expect(result.ok).toBe(true);
    expect(urls[0]).toBe('https://ui4a.internal/_meta/api/exec?scope=development');
  });

  it('keeps meta action exec on the declared lens path', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      urls.push(String(input));
      return response({
        properties: { rel: 'meta/drafts' },
        actions: [{ name: 'create', href: '/_meta/api/exec', fields: { type: 'object' } }],
      });
    });
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: 'opaque-token' },
    );
    await runCommand(
      parseArgs(['actions', 'exec', 'meta/drafts', 'create', '--params', '{}']),
      new Ui4aHttpClient(config, fetcher),
    );
    expect(urls).toEqual([
      'https://ui4a.internal/_meta/api/entity?rel=meta%2Fdrafts&scope=development',
      'https://ui4a.internal/_meta/api/exec?scope=development',
    ]);
  });
});
