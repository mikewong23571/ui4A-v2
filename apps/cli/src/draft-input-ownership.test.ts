import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from './args.js';
import { runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { Ui4aHttpClient } from './http.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function payloadFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ui4a-d54-cli-'));
  directories.push(directory);
  const path = join(directory, 'candidate.json');
  await writeFile(path, JSON.stringify({ name: 'post-status' }), 'utf8');
  return path;
}

function accepted(): Response {
  return Response.json({ entity: { properties: { rel: 'draft:d1' } } });
}

describe('D54 CLI Draft client ownership', () => {
  it.each([
    ['explicit', ['--command-id', 'command:explicit'] as string[]],
    ['generated', [] as string[]],
  ])(
    'reuses one %s commandId for a transient retry and omits server-owned params',
    async (_, id) => {
      const bodies: Array<{ params: Record<string, unknown> }> = [];
      let attempts = 0;
      const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as { params: Record<string, unknown> });
        attempts += 1;
        if (attempts === 1) throw new Error('transient connection reset');
        return accepted();
      });
      const config = await loadConfig(
        { configPath: '/definitely/missing' },
        {
          UI4A_BASE_URL: 'https://ui4a.internal',
          UI4A_TOKEN: 'opaque-token',
          UI4A_POLICY_SCOPE: 'forged-scope',
        },
      );
      const path = await payloadFile();

      await runCommand(
        parseArgs([
          'drafts',
          'create',
          '--kind',
          'flow-definition',
          '--target',
          'post-status',
          '--payload-file',
          path,
          ...id,
        ]),
        new Ui4aHttpClient(config, fetcher),
      );

      expect(bodies).toHaveLength(2);
      expect(bodies[0]?.params.commandId).toEqual(expect.any(String));
      expect(bodies[1]?.params.commandId).toBe(bodies[0]?.params.commandId);
      if (id.length > 0) expect(bodies[0]?.params.commandId).toBe('command:explicit');
      for (const body of bodies) {
        expect(body.params).not.toHaveProperty('policyScope');
        expect(body.params).not.toHaveProperty('schemaRef');
      }
    },
  );
});
