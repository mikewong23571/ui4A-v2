import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from './args.js';
import { runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { failure, redact } from './envelope.js';
import { Ui4aHttpClient } from './http.js';

const ACCESS_TOKEN = 'opaque.cli.credential';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('production CLI Bearer identity boundary', () => {
  it('rejects a Bearer credential over cleartext HTTP before any request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ unexpected: true }));
    let failure: unknown;

    try {
      const config = await loadConfig(
        { configPath: '/definitely/missing' },
        { UI4A_BASE_URL: 'http://ui4a.internal', UI4A_TOKEN: ACCESS_TOKEN },
      );
      await new Ui4aHttpClient(config, fetcher).get('/.well-known/ui4a.json');
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: 'CONFIG',
      exitCode: 3,
      message: 'Bearer authentication requires an HTTPS UI4A base URL',
    });
    expect(JSON.stringify(redact(failure))).not.toContain(ACCESS_TOKEN);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses one configured Bearer credential for discovery, read, and exec without self-reporting identity', async () => {
    const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const body = typeof init?.body === 'string' ? init.body : undefined;
      requests.push({
        url: url.toString(),
        headers: new Headers(init?.headers),
        ...(body === undefined ? {} : { body }),
      });
      if (url.pathname === '/.well-known/ui4a.json') {
        return response({ protocolVersion: '1', applications: [{ name: 'publishing' }] });
      }
      if (url.pathname === '/api/entity') {
        return response({
          properties: { rel: 'post:first' },
          actions: [{ name: 'unpublish', href: '/api/exec', fields: { type: 'object' } }],
        });
      }
      return response({ kind: 'executed' });
    });
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: ACCESS_TOKEN },
    );
    const client = new Ui4aHttpClient(config, fetcher);

    const outputs = [
      await runCommand(parseArgs(['apps', 'list']), client),
      await runCommand(parseArgs(['entities', 'get', 'post:first']), client),
      await runCommand(
        parseArgs(['actions', 'exec', 'post:first', 'unpublish', '--params', '{}']),
        client,
      ),
    ];

    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(request.headers.has('x-ui4a-principal')).toBe(false);
      expect(request.headers.has('x-ui4a-policy-scope')).toBe(false);
      expect(request.url).not.toContain(ACCESS_TOKEN);
      expect(request.body ?? '').not.toContain(ACCESS_TOKEN);
    }
    const execBody = JSON.parse(requests.at(-1)?.body ?? '{}') as Record<string, unknown>;
    expect(execBody).not.toHaveProperty('actor');
    expect(execBody).not.toHaveProperty('principal');
    expect(JSON.stringify(outputs)).not.toContain(ACCESS_TOKEN);
  });

  it('omits credential identity and policy fields from Bearer plan and Draft JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ui4a-cli-auth-red-'));
    const planPath = join(directory, 'plan.json');
    const payloadPath = join(directory, 'flow.json');
    await writeFile(
      planPath,
      JSON.stringify({
        actor: 'human',
        principal: 'forged-plan-owner',
        channel: 'forged-plan-channel',
        steps: [
          {
            rel: 'post:first',
            action: 'unpublish',
            params: {},
            actor: 'human',
            principal: 'forged-step-owner',
            channel: 'forged-step-channel',
          },
        ],
      }),
      'utf8',
    );
    await writeFile(payloadPath, JSON.stringify({ name: 'candidate' }), 'utf8');
    const bodies: Record<string, unknown>[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response({ kind: 'executed' });
    });
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: ACCESS_TOKEN },
    );
    const client = new Ui4aHttpClient(config, fetcher);

    try {
      await runCommand(parseArgs(['plans', 'submit', '--file', planPath]), client);
      await runCommand(
        parseArgs([
          'drafts',
          'create',
          '--kind',
          'flow-definition',
          '--target',
          'candidate',
          '--payload-file',
          payloadPath,
        ]),
        client,
      );
    } finally {
      await rm(directory, { recursive: true });
    }

    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).not.toHaveProperty('actor');
      expect(body).not.toHaveProperty('principal');
      expect(body).not.toHaveProperty('channel');
      expect(JSON.stringify(body)).not.toContain(ACCESS_TOKEN);
    }
    expect(bodies[0]).toMatchObject({
      steps: [expect.not.objectContaining({ actor: expect.anything() })],
    });
    expect(bodies[0]).toMatchObject({
      steps: [expect.not.objectContaining({ principal: expect.anything() })],
    });
    expect(bodies[0]).toMatchObject({
      steps: [expect.not.objectContaining({ channel: expect.anything() })],
    });
    // D54:scope remains outside public params; the Meta execution context resolves it from the
    // trusted identity/navigation context without manufacturing a second wire field.
    expect(bodies[1]).not.toHaveProperty('params.policyScope');
  });

  it('omits the self-reported policyScope query from Bearer Meta entity reads', async () => {
    const requestedUrls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      requestedUrls.push(String(input));
      return response({ properties: { rel: 'meta/application:publishing' }, actions: [] });
    });
    const config = await loadConfig(
      { configPath: '/definitely/missing' },
      {
        UI4A_BASE_URL: 'https://ui4a.internal',
        UI4A_TOKEN: ACCESS_TOKEN,
        UI4A_POLICY_SCOPE: 'forged-client-scope',
      },
    );

    await runCommand(
      parseArgs(['entities', 'get', 'meta/application:publishing']),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(requestedUrls).toHaveLength(1);
    const requested = new URL(requestedUrls[0]!);
    expect(requested.pathname).toBe('/_meta/api/entity');
    expect(requested.searchParams.get('rel')).toBe('meta/application:publishing');
    expect(requested.searchParams.has('policyScope')).toBe(false);
  });

  it('keeps self-reported headers and exec fields only for the explicit token-missing local demo', async () => {
    const requests: Array<{ headers: Headers; body?: string }> = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const body = typeof init?.body === 'string' ? init.body : undefined;
      requests.push({
        headers: new Headers(init?.headers),
        ...(body === undefined ? {} : { body }),
      });
      if (init?.method === 'POST') return response({ kind: 'executed' });
      return response({
        properties: { rel: 'post:first' },
        actions: [{ name: 'unpublish', href: '/api/exec', fields: { type: 'object' } }],
      });
    });
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});

    await runCommand(
      parseArgs(['actions', 'exec', 'post:first', 'unpublish', '--params', '{}']),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(requests[0]?.headers.get('authorization')).toBeNull();
    expect(requests[0]?.headers.get('x-ui4a-principal')).toBe('local-user');
    expect(requests[0]?.headers.get('x-ui4a-policy-scope')).toBe('publishing');
    expect(JSON.parse(requests[1]?.body ?? '{}')).toMatchObject({
      actor: 'agent',
      principal: 'local-user',
      channel: 'cli',
    });
  });

  it.each([
    ['missing', undefined, 'credential_missing', 401],
    ['expired', ACCESS_TOKEN, 'credential_expired', 401],
    ['forbidden', ACCESS_TOKEN, 'scope_insufficient', 403],
  ])(
    'fails honestly for a %s credential without leaking it',
    async (_case, token, code, status) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        response({ error: code, authorization: token }, status),
      );
      const config = await loadConfig(
        { configPath: '/definitely/missing' },
        {
          UI4A_BASE_URL: 'https://ui4a.internal',
          ...(token === undefined ? {} : { UI4A_TOKEN: token }),
        },
      );
      const client = new Ui4aHttpClient(config, fetcher);

      try {
        await runCommand(parseArgs(['apps', 'list']), client);
        throw new Error('expected the CLI request to fail');
      } catch (error) {
        expect(error).toMatchObject({ code: 'AUTH', exitCode: 4, status });
        const serialized = JSON.stringify(
          redact(failure('apps.list', error as Parameters<typeof failure>[1])),
        );
        expect(serialized).toContain(code);
        if (token !== undefined) expect(serialized).not.toContain(token);
      }
    },
  );

  it('rejects identity, authority, and SubmissionPolicy overrides before any HTTP request', () => {
    for (const flag of [
      '--actor',
      '--principal',
      '--scope',
      '--policy-scope',
      '--submission-mode',
      '--submission-policy',
      '--no-draft',
    ]) {
      expect(() => parseArgs(['actions', 'exec', 'post:first', 'archive', flag, 'root:*'])).toThrow(
        'server-owned',
      );
    }
  });
});
