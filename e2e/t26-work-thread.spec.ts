/**
 * T26 CLI actor track: headless work with no presence uses the same public Siren actions as humans.
 * The paired human/chat actor evidence lives in
 * apps/web/src/app/api/chat/route-ai-first.test.ts (presence source); this test deliberately keeps
 * UI4A presence absent and proves the canonical CLI source=action path without a real LLM.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { SCENARIO_BASE, withFreshServer } from './kits/server-kit';

const runFile = promisify(execFile);
const CLI_MAIN = path.join(process.cwd(), 'apps', 'cli', 'dist', 'main.js');

interface CliEnvelope {
  ok: boolean;
  command: string;
  data: unknown;
}

async function cli(...words: string[]): Promise<{ envelope: CliEnvelope; stdout: string }> {
  const { stdout } = await runFile(process.execPath, [CLI_MAIN, '--json', ...words], {
    env: {
      ...process.env,
      UI4A_BASE_URL: SCENARIO_BASE,
      UI4A_PRINCIPAL: 'user:t26-cli',
      UI4A_POLICY_SCOPE: 'publishing',
      XDG_CONFIG_HOME: '/tmp/ui4a-t26-cli-no-config',
    },
  });
  return { envelope: JSON.parse(stdout) as CliEnvelope, stdout };
}

function data<T>(result: { envelope: CliEnvelope }): T {
  expect(result.envelope.ok, JSON.stringify(result.envelope)).toBe(true);
  return result.envelope.data as T;
}

test('CLI without presence creates, attaches, reads, and audits one Work Thread', async () => {
  test.setTimeout(180_000);
  await withFreshServer(async () => {
    const collectionActions = await cli('actions', 'list', 'threads');
    expect(data<Array<{ name: string }>>(collectionActions).map(({ name }) => name)).toEqual([
      'create',
    ]);

    const created = await cli(
      'actions',
      'exec',
      'threads',
      'create',
      '--params',
      JSON.stringify({
        id: 'cli-release',
        goal: 'Ship through the public contract',
        goalSource: 'command:t26-cli',
      }),
    );
    expect(
      data<{ entity: { class: string[]; properties: Record<string, unknown> } }>(created),
    ).toMatchObject({
      entity: {
        class: ['work-thread', 'open'],
        properties: { id: 'cli-release', owner: 'user:t26-cli' },
      },
    });

    const exactActions = await cli('actions', 'list', 'thread:cli-release');
    expect(data<Array<{ name: string }>>(exactActions).map(({ name }) => name)).toEqual([
      'attach',
      'detach',
      'pause',
      'complete',
      'archive',
    ]);

    for (const [category, rel] of [
      ['context', 'articles'],
      ['active', 'article-drafting:main'],
      ['approval', 'confirmation:cli-review'],
      ['event', 'event:1'],
    ] as const) {
      const attached = await cli(
        'actions',
        'exec',
        'thread:cli-release',
        'attach',
        '--params',
        JSON.stringify({ category, rel }),
      );
      expect(data<{ entity: { properties: { id: string } } }>(attached)).toMatchObject({
        entity: { properties: { id: 'cli-release' } },
      });
    }

    const exact = await cli('entities', 'get', 'thread:cli-release');
    const entity = data<{
      properties: Record<string, unknown>;
      links: Array<{ rel: string[]; href: string }>;
    }>(exact);
    expect(entity.properties).toMatchObject({
      id: 'cli-release',
      owner: 'user:t26-cli',
      goal: { text: 'Ship through the public contract', source: 'command:t26-cli' },
      status: 'open',
      context: ['articles'],
      active: [
        {
          rel: 'article-drafting:main',
          status: 'basic-info',
          dangling: false,
        },
      ],
      approval: [{ rel: 'confirmation:cli-review', dangling: true }],
      'recent-events': [1],
    });
    expect(entity.properties).not.toHaveProperty('messages');
    expect(entity.links.map((link) => link.rel[0])).toEqual(
      expect.arrayContaining(['self', 'context', 'active', 'approval', 'event']),
    );

    const audit = await cli('audit', 'entity', 'thread:cli-release', '--limit', '100');
    const events = data<
      Array<{
        kind: string;
        action: string;
        detail: {
          category: string;
          rel: string;
          source: string;
          receipt: Record<string, unknown>;
        };
      }>
    >(audit);
    expect(events.map(({ kind }) => kind)).toEqual([
      'thread-created',
      'thread-reference-attached',
      'thread-reference-attached',
      'thread-reference-attached',
      'thread-reference-attached',
    ]);
    expect(events[0]).toMatchObject({
      kind: 'thread-created',
      action: 'create',
      detail: {
        owner: 'user:t26-cli',
        goal: { text: 'Ship through the public contract', source: 'command:t26-cli' },
        receipt: {
          declaration: { passed: true },
          guards: [{ name: 'thread-owner', pass: true }],
          schema: { passed: true },
          confirmation: { required: false, status: 'not-required' },
        },
      },
    });
    for (const event of events.slice(1)) {
      expect(event).toMatchObject({
        action: 'attach',
        detail: {
          source: 'action',
          receipt: {
            declaration: { passed: true },
            guards: [{ name: 'thread-owner', pass: true }],
            schema: { passed: true },
            confirmation: { required: false, status: 'not-required' },
          },
        },
      });
    }

    console.log(
      `[T26 CLI] actions=${data<Array<{ name: string }>>(exactActions)
        .map(({ name }) => name)
        .join(',')} context=${JSON.stringify(entity.properties.context)} events=${events
        .map(({ kind }) => kind)
        .join(',')} stdout=${exact.stdout.trim()}`,
    );
  });
});
