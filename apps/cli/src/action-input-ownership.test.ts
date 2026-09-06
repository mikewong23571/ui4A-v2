import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from './args.js';
import { runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { Ui4aHttpClient } from './http.js';

const action = {
  name: 'create',
  fields: {
    type: 'object',
    properties: {
      commandId: { type: 'string', 'x-ui4a-input-owner': 'client' },
      goal: { type: 'string' },
    },
    required: ['commandId', 'goal'],
  },
};
const argv = ['actions', 'exec', 'threads', 'create', '--params', '{"goal":"Original goal"}'];

describe('generic CLI declared client inputs', () => {
  it.each([{ flags: [] }, { flags: ['--command-id', 'explicit-retry-key'] }])(
    'injects a recoverable submission key and reports it: %j',
    async ({ flags }) => {
      const bodies: Array<{ params: Record<string, unknown> }> = [];
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
        if (init?.method !== 'POST') return Response.json({ actions: [action] });
        bodies.push(JSON.parse(String(init.body)));
        return Response.json({ entity: { properties: { rel: 'thread:result' } } });
      });
      const config = await loadConfig({ configPath: '/definitely/missing' }, {});
      const result = await runCommand(
        parseArgs([...argv, ...flags]),
        new Ui4aHttpClient(config, fetcher),
      );
      expect(bodies).toHaveLength(1);
      expect(bodies[0]?.params).toMatchObject({
        goal: 'Original goal',
        commandId: expect.any(String),
      });
      if (flags.length > 0) expect(bodies[0]?.params.commandId).toBe('explicit-retry-key');
      expect(result.data).toMatchObject({
        clientParams: { commandId: bodies[0]?.params.commandId },
      });
    },
  );
  it('derives observed versions from the same fresh declaration without exposing them to caller params', async () => {
    const versioned = {
      ...action,
      fields: {
        ...action.fields,
        properties: {
          ...action.fields.properties,
          baseVersion: { type: 'integer', 'x-ui4a-input-owner': 'client' },
        },
      },
    };
    let posted: Record<string, unknown> | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method !== 'POST')
        return Response.json({ properties: { version: 7 }, actions: [versioned] });
      posted = JSON.parse(String(init.body));
      return Response.json({ entity: {} });
    });
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});
    await runCommand(parseArgs(argv), new Ui4aHttpClient(config, fetcher));
    expect(posted).toMatchObject({ params: { baseVersion: 7 } });
  });
  it('does not reuse generated keys across independent invocations', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === 'POST'
        ? Response.json({ entity: {} })
        : Response.json({ actions: [action] }),
    );
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});
    const client = new Ui4aHttpClient(config, fetcher);
    const first = await runCommand(parseArgs(argv), client);
    const second = await runCommand(parseArgs(argv), client);
    expect((first.data as { clientParams: unknown }).clientParams).not.toEqual(
      (second.data as { clientParams: unknown }).clientParams,
    );
  });
  it('preserves the retry key in an uncertain failure for explicit recovery', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'POST') throw new Error('network lost');
      return Response.json({ actions: [action] });
    });
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});
    await expect(
      runCommand(parseArgs(argv), new Ui4aHttpClient(config, fetcher)),
    ).rejects.toMatchObject({
      code: 'NETWORK',
      retryable: true,
      details: { clientParams: { commandId: expect.any(String) } },
    });
  });
  it('rejects caller-supplied client params and does not write', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ actions: [action] }));
    const config = await loadConfig({ configPath: '/definitely/missing' }, {});
    await expect(
      runCommand(
        parseArgs([...argv.slice(0, -1), '{"goal":"x","commandId":"forged"}']),
        new Ui4aHttpClient(config, fetcher),
      ),
    ).rejects.toMatchObject({ code: 'USAGE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
