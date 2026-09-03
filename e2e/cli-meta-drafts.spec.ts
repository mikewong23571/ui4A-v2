import { execFileSync } from 'node:child_process';
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
  data?: { entity?: { properties?: { rel?: string } } };
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
