import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

// D65 闭环证据:ui4a CLI 二进制对真实 dev server 的 meta 写路径。
// 服务端要求 Draft 写动作携带显式授权应用 lens(?scope=),CLI 以 --scope
// 声明;本 spec 证明 CLI 构建的请求端到端满足该合同,防止服务端合同变更
// 再次静默漏掉 CLI 消费者(ops 站实证过的缺口)。

const CLI_ENTRY = join(process.cwd(), 'apps/cli/dist/main.js');
// 指向缺失路径,隔离本机 ~/.config/ui4a/config.json 与环境变量,保证可复现。
const ISOLATION = ['--config', '/definitely/missing/ui4a-config.json'];

interface Envelope {
  ok: boolean;
  command: string;
  data?: {
    entity?: { properties?: { rel?: string; status?: string; activation?: string } };
    properties?: { rel?: string; status?: string };
    algorithm?: string;
    added?: { applications?: string[]; flows?: string[] };
    schemas?: Record<string, { schema?: unknown; example?: Record<string, unknown> }>;
  };
  error?: { code?: string; message?: string };
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.UI4A_TOKEN;
  delete env.UI4A_POLICY_SCOPE;
  delete env.UI4A_BASE_URL;
  return env;
}

function runCli(args: string[]): { status: number; envelope: Envelope } {
  let status = 0;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [CLI_ENTRY, ...ISOLATION, ...args], {
      encoding: 'utf8',
      env: cleanEnv(),
      timeout: 20_000,
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    status = failure.status ?? 1;
    stdout = failure.stdout ?? '';
  }
  return { status, envelope: JSON.parse(stdout) as Envelope };
}

function payloadFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ui4a-e2e-cli-'));
  const path = join(directory, 'candidate.json');
  writeFileSync(path, JSON.stringify({ name: 'post-status' }), 'utf8');
  return path;
}

test.beforeAll(async () => {
  execFileSync('pnpm', ['--filter', '@ui4a/cli', 'build'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 180_000,
  });
});

test('CLI creates a governed Draft with an explicit application lens', () => {
  const { status, envelope } = runCli([
    '--base-url',
    'http://localhost:3100',
    '--json',
    '--scope',
    'publishing',
    'drafts',
    'create',
    '--kind',
    'flow-definition',
    '--target',
    'post-status',
    '--payload-file',
    payloadFile(),
  ]);

  expect(status).toBe(0);
  expect(envelope.ok).toBe(true);
  expect(envelope.data?.entity?.properties?.rel).toMatch(/^draft:/);
});

test('CLI reads back the created Draft through the same lens', () => {
  const created = runCli([
    '--base-url',
    'http://localhost:3100',
    '--json',
    '--scope',
    'publishing',
    'drafts',
    'create',
    '--kind',
    'flow-definition',
    '--target',
    'post-status',
    '--payload-file',
    payloadFile(),
  ]);
  const rel = created.envelope.data?.entity?.properties?.rel;
  expect(created.status).toBe(0);
  expect(rel).toMatch(/^draft:/);

  const read = runCli([
    '--base-url',
    'http://localhost:3100',
    '--json',
    '--scope',
    'publishing',
    'drafts',
    'get',
    rel!,
  ]);
  expect(read.status).toBe(0);
  expect(read.envelope.ok).toBe(true);
  expect(read.envelope.data?.properties?.rel).toBe(rel);
});

test('local demo mode still creates without a flag via its declared local scope', () => {
  const { status, envelope } = runCli([
    '--base-url',
    'http://localhost:3100',
    '--json',
    'drafts',
    'create',
    '--kind',
    'flow-definition',
    '--target',
    'post-status',
    '--payload-file',
    payloadFile(),
  ]);

  expect(status).toBe(0);
  expect(envelope.ok).toBe(true);
  expect(envelope.data?.entity?.properties?.rel).toMatch(/^draft:/);
});

// ---- T48 Phase 6a / G3·US9:application-bundle Draft 的 CLI 全环 ----
// CLI 起草 --kind application-bundle → 复用 validate/diff/submit → 人类批准后
// apps list 立即发现新 app(S2 精神:批准即发现,零 prompt/零部署变更)。
// 边界:CLI 面无 approve 命令(help 不含;见 apps/cli/src/commands-drafts.test.ts
// 的锁),generic `actions exec` 对 activation 的 approve 也以 APPROVAL_FORBIDDEN
// 拒绝;人类批准由本地 demo 通道直连 /_meta/api/exec(principal 与 CLI 本地
// 默认 draft owner `local-user` 一致,lens 与创建时同为 publishing)。

function bundlePayload(bundleName: string): Record<string, unknown> {
  // 与 apps/web/src/engine/drafts/application-bundle.test.ts 的最小合法 bundle
  // 同形;target 是新 app 名,不要求落在 lens 内(lens 只要求已授予)。
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name: bundleName, version: 1 },
    applications: [
      {
        name: bundleName,
        title: 'E2E CLI Demo',
        intent: 'Installed via the CLI governed full loop',
      },
    ],
    capabilities: [],
    flows: [
      {
        name: `${bundleName}-entry`,
        title: 'E2E entry',
        app: bundleName,
        initial: 'start',
        nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
        fields: [],
      },
    ],
    seed: { rel: `seed:${bundleName}`, detail: { instances: {} } },
  };
}

function bundleFile(bundleName: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'ui4a-e2e-cli-bundle-'));
  const path = join(directory, 'bundle.json');
  writeFileSync(path, JSON.stringify(bundlePayload(bundleName)), 'utf8');
  return path;
}

// 测试库跨 spec 共享且可能残留历史安装;每次运行取全新 app 名,
// 保证服务端 application-not-installed 检查稳定成立。
function freshBundleName(): string {
  return `e2e-cli-app-${randomUUID().slice(0, 8)}`;
}

function cliBase(): string[] {
  return ['--base-url', 'http://localhost:3100', '--json', '--scope', 'publishing'];
}

function createBundleDraft(bundleName: string): { status: number; envelope: Envelope } {
  return runCli([
    ...cliBase(),
    'drafts',
    'create',
    '--kind',
    'application-bundle',
    '--target',
    bundleName,
    '--payload-file',
    bundleFile(bundleName),
    '--command-id',
    `e2e:bundle:create:${bundleName}`,
  ]);
}

function submitBundleDraft(
  rel: string,
  bundleName: string,
): { status: number; envelope: Envelope } {
  return runCli([
    ...cliBase(),
    'drafts',
    'submit',
    rel,
    '--command-id',
    `e2e:bundle:submit:${bundleName}`,
  ]);
}

async function humanApprove(activation: string, bundleName: string): Promise<Response> {
  return fetch('http://localhost:3100/_meta/api/exec?scope=publishing', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      rel: activation,
      action: 'approve',
      actor: 'human',
      principal: 'local-user',
      channel: 'e2e',
      params: { commandId: `e2e:bundle:approve:${bundleName}` },
    }),
  });
}

function applicationNames(envelope: Envelope): string[] {
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  return rows.map((row) => String((row as { name?: unknown }).name));
}

test('CLI shepherds an application-bundle Draft through create, validate, diff and submit', () => {
  const bundleName = freshBundleName();
  const created = createBundleDraft(bundleName);
  expect(created.status).toBe(0);
  expect(created.envelope.ok).toBe(true);
  const rel = created.envelope.data?.entity?.properties?.rel;
  expect(rel).toMatch(/^draft:/);

  const validated = runCli([
    ...cliBase(),
    'drafts',
    'validate',
    rel!,
    '--command-id',
    `e2e:bundle:validate:${bundleName}`,
  ]);
  expect(validated.status).toBe(0);
  expect(validated.envelope.data?.entity?.properties?.status).toBe('ready');

  const diffed = runCli([...cliBase(), 'drafts', 'diff', rel!]);
  expect(diffed.status).toBe(0);
  expect(diffed.envelope.data).toMatchObject({
    algorithm: 'bundle-inventory',
    added: { applications: [bundleName], flows: [`${bundleName}-entry`] },
  });

  const submitted = submitBundleDraft(rel!, bundleName);
  expect(submitted.status).toBe(0);
  expect(submitted.envelope.data?.entity?.properties).toMatchObject({
    status: 'pending-approval',
    activation: expect.stringMatching(/^meta\/activation:draft-/),
  });
});

test('human approval of a CLI-submitted bundle installs it and apps list discovers it immediately', async () => {
  const bundleName = freshBundleName();
  const created = createBundleDraft(bundleName);
  expect(created.status).toBe(0);
  const rel = created.envelope.data?.entity?.properties?.rel ?? '';
  const submitted = submitBundleDraft(rel, bundleName);
  expect(submitted.status).toBe(0);
  const activation = submitted.envelope.data?.entity?.properties?.activation ?? '';
  expect(activation).toMatch(/^meta\/activation:draft-/);

  // CLI 永不审批:面内无 approve 命令,generic 通道同样拒绝(APPROVAL_FORBIDDEN)。
  const forbidden = runCli([
    ...cliBase(),
    'actions',
    'exec',
    activation,
    'approve',
    '--params',
    JSON.stringify({ commandId: `e2e:bundle:cli-approve:${bundleName}` }),
  ]);
  expect(forbidden.status).toBe(4);
  expect(forbidden.envelope.error?.code).toBe('APPROVAL_FORBIDDEN');

  // 批准前:新 app 不可见——发现只来自批准,不来自草稿本身。
  const before = runCli(['--base-url', 'http://localhost:3100', '--json', 'apps', 'list']);
  expect(before.status).toBe(0);
  expect(applicationNames(before.envelope)).not.toContain(bundleName);

  // 人类通道批准(本地 demo 自报身份;principal/lens 与 CLI 创建一致)。
  const approval = await humanApprove(activation, bundleName);
  expect(approval.status).toBe(200);

  // 批准即发现:同一条只读 CLI 命令立即列出新 app(S2:零 prompt/零部署变更)。
  const after = runCli(['--base-url', 'http://localhost:3100', '--json', 'apps', 'list']);
  expect(after.status).toBe(0);
  expect(applicationNames(after.envelope)).toContain(bundleName);

  const flows = runCli(['--base-url', 'http://localhost:3100', '--json', 'flows', 'list']);
  expect(flows.status).toBe(0);
  const flowRows = Array.isArray(flows.envelope.data) ? flows.envelope.data : [];
  expect(flowRows).toContainEqual(
    expect.objectContaining({ name: `${bundleName}-entry`, app: bundleName }),
  );

  const resolved = runCli([...cliBase(), 'activations', 'get', activation]);
  expect(resolved.status).toBe(0);
  expect(resolved.envelope.data?.properties?.status).toBe('accepted');
});

// ---- T50 Phase 5 / D69.5:`drafts schema` 语法糖 ----
// 零内嵌真相的读门:CLI 只透传 meta/drafts create 动作 fields 顶层的
// x-ui4a-payload-schemas 合同注解,不持任何本地 schema 副本。本组证明:
// (1) CLI 输出与直连服务端读到的注解等值(全量与 --kind 过滤两态);
// (2) 注解 example 经机械改名(序列化文本的字符串替换,不手工构造结构)
// 即可作为 payload-file 创建 ready Draft——P6「机械自足」的预演。

async function serverPayloadSchemas(): Promise<Record<string, unknown>> {
  // 与 CLI --scope publishing 构建的同一条 meta 实体读(本地 demo 身份默认
  // local-user,与服务端缺省回退一致);直连取得合同注解原值。
  const response = await fetch(
    'http://localhost:3100/_meta/api/entity?rel=meta%2Fdrafts&scope=publishing',
  );
  expect(response.status).toBe(200);
  const entity = (await response.json()) as {
    actions?: { name?: string; fields?: Record<string, unknown> }[];
  };
  const create = entity.actions?.find((action) => action.name === 'create');
  const annotation = create?.fields?.['x-ui4a-payload-schemas'];
  expect(annotation, 'server must annotate the create action fields').toBeTruthy();
  return annotation as Record<string, unknown>;
}

test('CLI drafts schema mirrors the server payload-schemas annotation, full and filtered', async () => {
  const serverSchemas = await serverPayloadSchemas();

  const full = runCli([...cliBase(), 'drafts', 'schema']);
  expect(full.status).toBe(0);
  expect(full.envelope.ok).toBe(true);
  expect(full.envelope.command).toBe('drafts.schema');
  expect(full.envelope.data?.schemas).toEqual(serverSchemas);

  const filtered = runCli([...cliBase(), 'drafts', 'schema', '--kind', 'application-bundle']);
  expect(filtered.status).toBe(0);
  expect(filtered.envelope.data?.schemas).toEqual({
    'application-bundle': serverSchemas['application-bundle'],
  });
});

test('the annotated example mechanically derives a ready application-bundle Draft', async () => {
  const filtered = runCli([...cliBase(), 'drafts', 'schema', '--kind', 'application-bundle']);
  expect(filtered.status).toBe(0);
  const example = filtered.envelope.data?.schemas?.['application-bundle']?.example;
  expect(example, 'application-bundle annotation carries an example').toBeTruthy();

  // 机械派生:example 是最小合法 bundle 但名字固定('example-bundle'),
  // 与历史安装可能冲突;仅对序列化文本做名字字符串替换(bundle/app/flow/
  // seed 引用一致跟随),结构零改动。target 必须等于 bundle.name。
  const bundleName = freshBundleName();
  const derived = JSON.parse(
    JSON.stringify(example)
      .replaceAll('example-bundle', bundleName)
      .replaceAll('example-entry', `${bundleName}-entry`),
  ) as Record<string, unknown>;

  const directory = mkdtempSync(join(tmpdir(), 'ui4a-e2e-cli-schema-'));
  const path = join(directory, 'bundle.json');
  writeFileSync(path, JSON.stringify(derived), 'utf8');

  const created = runCli([
    ...cliBase(),
    'drafts',
    'create',
    '--kind',
    'application-bundle',
    '--target',
    bundleName,
    '--payload-file',
    path,
    '--command-id',
    `e2e:schema:create:${bundleName}`,
  ]);
  expect(created.status).toBe(0);
  expect(created.envelope.ok).toBe(true);
  const rel = created.envelope.data?.entity?.properties?.rel;
  expect(rel).toMatch(/^draft:/);

  const validated = runCli([
    ...cliBase(),
    'drafts',
    'validate',
    rel!,
    '--command-id',
    `e2e:schema:validate:${bundleName}`,
  ]);
  expect(validated.status).toBe(0);
  expect(validated.envelope.data?.entity?.properties?.status).toBe('ready');
});
