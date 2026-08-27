import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, test, type Request, type Response } from '@playwright/test';
import type { SurfaceBinding, SurfaceNode, SurfaceTree } from '@ui4a/engine';

import { MECHANISM_WORDS } from '../apps/web/src/lib/mechanism-words';
import { SCENARIO_BASE, withFreshServer, withWorkerServer } from './kits/server-kit';
import { terminateStaleNotifyWorkflows } from '../apps/web/src/temporal/notify';

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
        UI4A_PRINCIPAL: 'local-user',
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
      // T33:链接标签优先合同 title(在等我/在动/我的工作线),回退 target rel
      await expect(
        surface.locator(`a[href="/entity?rel=${encodeURIComponent(canonicalRel)}"]`),
      ).toHaveText(title);
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

test('waiting-for-me 成员决策卡:批准一击零导航零参数,同一裁决(T33 D50)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // 与 s1 同口径:清掉跨轮次残留的 notify workflow(确认 id 确定性复用)。
  await terminateStaleNotifyWorkflows(['c1']);
  await withWorkerServer(async () => {
    // agent 经 HTTP 合同提议 archive(202 挂起)→ 收件箱出现待决确认。
    const propose = await fetch(`${SCENARIO_BASE}/api/exec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rel: 'post:post-welcome',
        action: 'archive',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'e2e',
      }),
    });
    expect(propose.status).toBe(202);
    expect(((await propose.json()) as { status?: string }).status).toBe('suspended');

    // 建线先于首次 Presentation 规划(work-lines 为 invalidate 区域,成员
    // 变化重规划;首版规划即见带动作成员 → 决策卡)。
    const created = await fetch(`${SCENARIO_BASE}/api/exec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rel: 'threads',
        action: 'create',
        actor: 'human',
        principal: 'local-user',
        channel: 'renderer',
        params: {
          id: 'release-t33',
          goal: 'T33 验收工作线',
          goalSource: 'chat:e2e-t33',
        },
      }),
    });
    expect(created.status).toBe(200);

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto(SCENARIO_BASE);
    const surface = page.locator('[data-surface]');
    await expect(surface).toHaveCount(1);

    // 在等我区域:成员渲染为决策卡(身份行 = 投影携带的任务语言 identity);
    // 工作线的建线成员同为决策卡(成员带已声明动作),按文本分别定位。
    const card = surface.locator('[data-word="member-card"]', {
      hasText: 'archive · 由 agent 提议',
    });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('confirmation:c1');

    // 责任点一等:批准为推送按钮(零参数、零导航),data-action 背书同一合同。
    const approve = card.getByRole('button', { name: '批准', exact: true });
    await expect(approve).toBeEnabled();
    await expect(approve).toHaveAttribute('data-action', 'approve');
    await approve.click();

    // 同一裁决:轮询事件日志,confirmation-approved 的 actor=human
    // (channel=confirmation:生效动作经确认门落账,渲染器触发)。
    let decision: { kind: string; actor?: string; channel?: string } | undefined;
    for (let attempt = 0; attempt < 25 && decision === undefined; attempt += 1) {
      const events = (await (
        await fetch(`${SCENARIO_BASE}/api/events`)
      ).json()) as { events: Array<{ kind: string; actor?: string; channel?: string }> };
      decision = events.events.find((event) => event.kind === 'confirmation-approved');
      if (decision === undefined) await page.waitForTimeout(200);
    }
    expect(decision?.actor).toBe('human');
    expect(decision?.channel).toBe('confirmation');

    // 投影随事件更新:重载后在等我清零,确认决策卡退场;工作线成员卡呈现
    // 目标 +「停在「open」」(active 空回退线程状态;投影数据,零渲染器模板)。
    await page.reload();
    await expect(
      page.locator('[data-word="member-card"]', { hasText: 'archive · 由 agent 提议' }),
    ).toHaveCount(0);
    const threadCard = page.locator('[data-word="member-card"]', {
      hasText: 'T33 验收工作线',
    });
    await expect(threadCard).toHaveCount(1);
    await expect(threadCard).toContainText('停在「open」');
    await expect(threadCard).toContainText('填写挂载引用参数');
    const inbox = (await (
      await fetch(`${SCENARIO_BASE}/api/entity?rel=inbox`)
    ).json()) as { properties: { count: number } };
    expect(inbox.properties.count).toBe(0);
  });
});
