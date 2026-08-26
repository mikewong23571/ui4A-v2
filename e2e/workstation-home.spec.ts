import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test, type Request, type Response } from '@playwright/test';
import type { SurfaceBinding, SurfaceNode, SurfaceTree } from '@ui4a/engine';

import { MECHANISM_WORDS } from '../apps/web/src/lib/mechanism-words';
import { SCENARIO_BASE, withFreshServer } from './kits/server-kit';

const runFile = promisify(execFile);
const CLI_MAIN = path.join(process.cwd(), 'apps', 'cli', 'dist', 'main.js');
const SOURCE_REGIONS = [
  { region: 'waiting-for-me', rel: 'inbox', title: '在等我' },
  { region: 'in-motion', rel: 'delegations', title: '在动' },
  { region: 'work-lines', rel: 'threads', title: '我的工作线' },
] as const;

interface CliEnvelope<T> {
  schemaVersion: number;
  ok: boolean;
  command: string;
  data: T;
  meta: { cliVersion?: unknown; requestId?: unknown };
}

interface SirenEntity {
  class: string[];
  properties: Record<string, unknown>;
  actions: unknown[];
  links: Array<{ rel: string[]; href: string }>;
  entities?: SirenEntity[];
}

interface SidecarResponse {
  sidecar: {
    key: { subject: string };
    surface: SurfaceTree;
  };
}

async function cli<T>(...words: string[]): Promise<CliEnvelope<T>> {
  const { stdout } = await runFile(
    process.execPath,
    [CLI_MAIN, '--json', ...words, '--base-url', SCENARIO_BASE],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UI4A_PRINCIPAL: 'user:local',
        UI4A_POLICY_SCOPE: 'publishing',
        XDG_CONFIG_HOME: '/tmp/ui4a-workstation-home-no-config',
      },
      maxBuffer: 1024 * 1024,
    },
  );
  return JSON.parse(stdout) as CliEnvelope<T>;
}

function expectSuccess<T>(envelope: CliEnvelope<T>, command: string): T {
  expect(envelope).toMatchObject({
    schemaVersion: 1,
    ok: true,
    command,
    data: expect.anything(),
    meta: {
      cliVersion: expect.any(String),
      requestId: expect.any(String),
    },
  });
  return envelope.data;
}

function bindingSubjects(node: SurfaceNode): Set<string> {
  const subjects = new Set<string>();
  const add = (binding: SurfaceBinding): void => {
    if (binding.kind !== 'item') subjects.add(binding.subject);
  };
  const walk = (candidate: SurfaceNode): void => {
    if (candidate.kind === 'layout') candidate.children.forEach(walk);
    if (candidate.kind === 'slot') walk(candidate.child);
    if (candidate.kind === 'repeat') {
      add(candidate.source);
      walk(candidate.item);
    }
    if (candidate.kind === 'word') Object.values(candidate.bindings).forEach(add);
  };
  walk(node);
  return subjects;
}

function presentationPost(request: Request): boolean {
  const url = new URL(request.url());
  return request.method() === 'POST' && url.pathname === '/api/presentation';
}

function sidecarRead(response: Response): boolean {
  const url = new URL(response.url());
  return response.request().method() === 'GET' && url.pathname === '/api/presentation/sidecar';
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(60_000);
  await runFile('pnpm', ['cli:build'], { cwd: process.cwd() });
  const { stdout } = await runFile(process.execPath, [CLI_MAIN, '--help'], {
    cwd: process.cwd(),
  });
  expect(stdout).toContain('UI4A HTTP/Siren/meta reference client');
  expect(stdout).toContain('entities get|resolve <rel>');
});

test('workstation home and the real CLI read the same three declared source entities', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await withFreshServer(async () => {
    const doctor = expectSuccess(
      await cli<{
        endpoint: string;
        policyScope: string;
        probes: Record<string, { reachable: boolean; status: number }>;
      }>('doctor'),
      'doctor',
    );
    expect(doctor).toMatchObject({
      endpoint: SCENARIO_BASE,
      policyScope: 'publishing',
      probes: {
        health: { reachable: true, status: 200 },
        business: { reachable: true, status: 200 },
        meta: { reachable: true, status: 200 },
      },
    });

    const entities = new Map<string, SirenEntity>();
    for (const { rel, title } of SOURCE_REGIONS) {
      const entity = expectSuccess(await cli<SirenEntity>('entities', 'get', rel), 'entities.get');
      expect(entity.properties.rel).toBe(rel);
      expect(entity.properties.title).toBe(title);
      expect(entity.properties.presentation).toEqual({
        fields: [{ path: 'properties.title', title: '标题', role: 'identity' }],
      });
      entities.set(rel, entity);
    }

    const presentationRequests: Request[] = [];
    page.on('request', (request) => {
      if (presentationPost(request)) presentationRequests.push(request);
    });
    const presentationRequest = page.waitForRequest(presentationPost);
    const sidecarResponse = page.waitForResponse(sidecarRead);
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(SCENARIO_BASE);

    const request = await presentationRequest;
    expect(request.postDataJSON()).toMatchObject({
      subject: 'workspace:my-work',
      delivery: 'canvas',
    });

    const sidecar = (await (await sidecarResponse).json()) as SidecarResponse;
    expect(sidecar.sidecar.key.subject).toBe('workspace:my-work');
    expect(sidecar.sidecar.surface.root.kind).toBe('layout');
    if (sidecar.sidecar.surface.root.kind !== 'layout') {
      throw new Error('my-work Sidecar root is not the declared region layout');
    }
    expect(sidecar.sidecar.surface.root.children).toHaveLength(SOURCE_REGIONS.length);
    for (const [index, expected] of SOURCE_REGIONS.entries()) {
      const slot = sidecar.sidecar.surface.root.children[index];
      expect(slot).toMatchObject({ kind: 'slot', name: expected.region });
      expect([...bindingSubjects(slot!)].sort()).toEqual([expected.rel]);
    }

    const surface = page.locator('[data-surface]');
    await expect(surface).toHaveCount(1);
    await expect(surface).toBeVisible();
    await expect(page.locator('[data-testid="canvas-errors"]')).toHaveCount(0);
    expect(presentationRequests).toHaveLength(1);

    for (const { rel, title } of SOURCE_REGIONS) {
      const entity = entities.get(rel)!;
      const canonicalRel = String(entity.properties.rel);
      const heading = surface.getByRole('heading', { name: title, exact: true });
      await expect(heading).toHaveCount(1);
      await expect(heading).toBeVisible();
      await expect(heading).toBeInViewport();
      await expect(
        surface.locator(`a[href="/entity?rel=${encodeURIComponent(canonicalRel)}"]`),
      ).toHaveText(canonicalRel);
    }

    const expectedScalarFacts = [...entities.values()]
      .flatMap((entity) =>
        Object.entries(entity.properties).flatMap(([key, value]) =>
          !['rel', 'title'].includes(key) && ['string', 'number', 'boolean'].includes(typeof value)
            ? [String(value)]
            : [],
        ),
      )
      .sort();
    const renderedScalarFacts = (
      await surface.locator('p:not([data-testid="action-contract-legend"])').allTextContents()
    ).sort();
    expect(renderedScalarFacts).toEqual(expectedScalarFacts);

    const members = [...entities.values()].flatMap((entity) => entity.entities ?? []);
    await expect(surface.locator('[data-nav="presentation:member"]')).toHaveCount(members.length);
    for (const member of members) {
      const rel = member.properties.rel;
      expect(typeof rel).toBe('string');
      await expect(
        surface.locator(
          `[data-nav="presentation:member"][href="/canvas?focus=${encodeURIComponent(
            String(rel),
          )}"]`,
        ),
      ).toBeVisible();
    }

    const mainText = await page.locator('main').innerText();
    const forbiddenFirstScreenWords = [
      ...MECHANISM_WORDS,
      'Sidecar',
      'Surface',
      'catalog',
      '依赖',
      '版本',
      ...SOURCE_REGIONS.map(({ region }) => region),
    ];
    const leaked = forbiddenFirstScreenWords.filter((word) => mainText.includes(word));
    expect(leaked, `workstation 首屏泄漏机制词:${leaked.join('、')}`).toEqual([]);

    await page.locator('[data-nav="local:canvas-why"]').click();
    const drawer = page.getByTestId('canvas-why-drawer');
    await expect(drawer).toBeVisible();
    await page.getByTestId('canvas-why-explain').click();
    const declaredRegions = page.getByTestId('canvas-why-composition-regions');
    await expect(declaredRegions.locator('li')).toHaveText(
      SOURCE_REGIONS.map(({ region }) => `${region} ·可用`),
    );
  });
});
