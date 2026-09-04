import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseArgs } from './args.js';
import { HELP, runCommand } from './commands.js';
import { loadConfig } from './config.js';
import { Ui4aHttpClient } from './http.js';

// T48 Phase 6a / G3·US9:CLI 对 application-bundle Draft 的起草合同。
// create 对三种 Draft kind 同构透传(无客户端白名单);此处锁住请求体形状、
// help 文档与"CLI 永不审批"边界,防止后续改动静默丢掉 bundle 起草入口。

const BUNDLE: Record<string, unknown> = {
  schema: 'https://ui4a.dev/application-bundle/v1',
  bundle: { name: 'demo-bundle', version: 1 },
  applications: [
    { name: 'demo-bundle', title: 'Demo', intent: 'Demonstrate a governed bundle installation' },
  ],
  capabilities: [],
  flows: [
    {
      name: 'demo-bundle-entry',
      title: 'Demo entry',
      app: 'demo-bundle',
      initial: 'start',
      nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
      fields: [],
    },
  ],
  seed: { rel: 'seed:demo-bundle', detail: { instances: {} } },
};

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function bundleFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ui4a-t48-cli-'));
  directories.push(directory);
  const path = join(directory, 'bundle.json');
  await writeFile(path, JSON.stringify(BUNDLE), 'utf8');
  return path;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('T48 CLI application-bundle Draft authoring', () => {
  it('documents all governed Draft kinds and keeps approval out of the CLI surface', () => {
    expect(HELP).toContain('drafts create');
    expect(HELP).toContain('application-bundle');
    expect(HELP).not.toMatch(/drafts approve/);
    expect(HELP).not.toMatch(/activations approve/);
  });

  it('builds the meta create exec request for an application-bundle Draft', async () => {
    const captures: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      captures.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return response({
        entity: { properties: { rel: 'draft:d1', kind: 'application-bundle', status: 'ready' } },
      });
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
        'application-bundle',
        '--target',
        'demo-bundle',
        '--payload-file',
        await bundleFile(),
        '--command-id',
        'bundle:create',
      ]),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result).toMatchObject({ ok: true, command: 'drafts.create' });
    expect(result.data).toMatchObject({ entity: { properties: { rel: 'draft:d1' } } });
    expect(captures).toHaveLength(1);
    expect(captures[0]?.url).toBe('https://ui4a.internal/_meta/api/exec?scope=development');
    expect(captures[0]?.body).toEqual({
      rel: 'meta/drafts',
      action: 'create',
      params: {
        kind: 'application-bundle',
        target: 'demo-bundle',
        commandId: 'bundle:create',
        payload: BUNDLE,
      },
    });
  });

  it('self-reports the agent identity when creating without a credential', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return response({ entity: { properties: { rel: 'draft:d2' } } });
    });
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      {},
    );
    const result = await runCommand(
      parseArgs([
        'drafts',
        'create',
        '--kind',
        'application-bundle',
        '--target',
        'demo-bundle',
        '--payload-file',
        await bundleFile(),
        '--command-id',
        'bundle:create:local',
      ]),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result.ok).toBe(true);
    expect(bodies[0]).toMatchObject({
      rel: 'meta/drafts',
      action: 'create',
      actor: 'agent',
      channel: 'cli',
      principal: expect.any(String),
      params: { kind: 'application-bundle', target: 'demo-bundle' },
    });
  });

  it('refuses to execute approve on a Draft activation even when the action is declared', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      response({
        properties: { rel: 'meta/activation:draft-1' },
        actions: [{ name: 'approve', href: '/_meta/api/exec', fields: { type: 'object' } }],
      }),
    );
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      {},
    );
    await expect(
      runCommand(
        parseArgs([
          'actions',
          'exec',
          'meta/activation:draft-1',
          'approve',
          '--params',
          '{"commandId":"forbidden"}',
        ]),
        new Ui4aHttpClient(config, fetcher),
      ),
    ).rejects.toMatchObject({ code: 'APPROVAL_FORBIDDEN', exitCode: 4 });
    expect(fetcher, 'no write may leave the CLI for approve').toHaveBeenCalledTimes(1);
  });
});

// ---- T50 Phase 5 / D69.5:`drafts schema` 语法糖 ----
// 零内嵌真相:只读取 meta/drafts create 动作 fields 顶层的
// x-ui4a-payload-schemas 合同注解并原样透传(kind → { schema, example? });
// 动作缺失、无注解或 kind 未被服务端注解时诚实输出空表,不造默认 schema,
// 也没有本地 kind 白名单。读失败沿既有 HTTP 错误 envelope。

const PAYLOAD_ANNOTATION: Record<string, unknown> = {
  'application-bundle': {
    schema: { type: 'object', required: ['schema', 'bundle'], properties: {} },
    example: BUNDLE,
  },
  'flow-definition': { schema: {} },
  'agent-definition': { schema: {} },
};

function draftsEntity(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    properties: { rel: 'meta/drafts' },
    entities: [],
    actions: [
      {
        name: 'create',
        href: '/_meta/api/exec',
        fields: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { kind: { type: 'string' }, payload: {} },
          required: ['kind', 'payload'],
          additionalProperties: false,
          'x-ui4a-payload-schemas': PAYLOAD_ANNOTATION,
          ...fields,
        },
      },
    ],
  };
}

describe('T50 CLI drafts schema sugar', () => {
  it('documents the drafts schema read sugar in HELP', () => {
    expect(HELP).toContain('drafts schema [--kind KIND]');
  });

  it('reads the annotated payload schemas from the meta create action verbatim', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      urls.push(String(input));
      return response(draftsEntity());
    });
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      { UI4A_BASE_URL: 'https://ui4a.internal', UI4A_TOKEN: 'opaque-token' },
    );
    const result = await runCommand(
      parseArgs(['drafts', 'schema']),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result.ok).toBe(true);
    expect(result.command).toBe('drafts.schema');
    expect(urls).toEqual([
      'https://ui4a.internal/_meta/api/entity?rel=meta%2Fdrafts&scope=development',
    ]);
    // 逐字节等值透传:CLI 不改写、不裁剪、不补默认。
    expect(result.data).toEqual({ schemas: PAYLOAD_ANNOTATION });
  });

  it('filters to a single kind entry with --kind', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(draftsEntity()));
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      {},
    );
    const result = await runCommand(
      parseArgs(['drafts', 'schema', '--kind', 'application-bundle']),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      schemas: { 'application-bundle': PAYLOAD_ANNOTATION['application-bundle'] },
    });
  });

  it('reports honest empty schemas when the create action or annotation is missing', async () => {
    // JSON 序列化丢弃 undefined 键,与真实 wire 上"无注解"的形状一致。
    const withoutAnnotation = JSON.parse(
      JSON.stringify(draftsEntity({ 'x-ui4a-payload-schemas': undefined })),
    ) as Record<string, unknown>;
    const withoutActions = { properties: { rel: 'meta/drafts' } };
    const queue: Record<string, unknown>[] = [withoutAnnotation, withoutActions];
    const fetcher = vi.fn<typeof fetch>(async () => response(queue.shift()));
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      {},
    );

    const first = await runCommand(
      parseArgs(['drafts', 'schema']),
      new Ui4aHttpClient(config, fetcher),
    );
    expect(first.ok).toBe(true);
    expect(first.data).toEqual({ schemas: {} });

    const second = await runCommand(
      parseArgs(['drafts', 'schema']),
      new Ui4aHttpClient(config, fetcher),
    );
    expect(second.ok).toBe(true);
    expect(second.data).toEqual({ schemas: {} });
  });

  it('reports honest empty schemas for a kind the server did not annotate', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(draftsEntity()));
    const config = await loadConfig(
      { scope: 'development', configPath: '/definitely/missing' },
      {},
    );
    const result = await runCommand(
      parseArgs(['drafts', 'schema', '--kind', 'not-a-draft-kind']),
      new Ui4aHttpClient(config, fetcher),
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ schemas: {} });
  });
});
