import { expect, test } from '@playwright/test';

import type {
  SirenEntity,
  SurfaceBinding,
  SurfaceNode,
  SurfaceTree,
  UserSidecarKey,
} from '@ui4a/engine';
import { contentVersion, fold } from '@ui4a/engine';

import { listEvents, readLog } from '../apps/web/src/db/events';
import { getPool } from '../apps/web/src/db/pool';
import {
  findActiveSidecar,
  loadPresentationSnapshot,
  rebuildPresentationProjection,
} from '../apps/web/src/db/presentation';
import { businessFlows } from '../apps/web/src/domain/flows';
import { hydratePresentationSurface } from '../apps/web/src/render/presentation/generic';
import { DATABASE_URL, SCENARIO_BASE, withFreshServer } from './kits/server-kit';

test.use({ baseURL: SCENARIO_BASE });

const key: UserSidecarKey = {
  principal: 'local-user',
  policyScope: 'local-demo',
  subject: 'workspace:my-work',
  intent: 'work overview',
  deviceClass: 'any',
};

interface SidecarResponse {
  sidecar: {
    id: string;
    key: UserSidecarKey;
    surface: SurfaceTree;
  };
}

function walk(node: SurfaceNode, visit: (candidate: SurfaceNode) => void): void {
  visit(node);
  if (node.kind === 'layout') node.children.forEach((child) => walk(child, visit));
  if (node.kind === 'slot') walk(node.child, visit);
  if (node.kind === 'repeat') walk(node.item, visit);
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

test('my-work request renders one binding-only three-region Canvas and replays in isolation', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await withFreshServer(async () => {
    const pool = getPool(DATABASE_URL);
    const businessBefore = contentVersion(fold(await readLog(pool), { flows: businessFlows }));
    const response = await fetch(`${SCENARIO_BASE}/api/presentation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        requestId: 't30:my-work:e2e',
        principal: key.principal,
        subject: key.subject,
        intent: key.intent,
        delivery: 'canvas',
        sourceMessageIds: [],
      }),
    });
    expect(response.ok).toBe(true);
    const receipt = (await response.json()) as {
      status?: string;
      reasonCode?: string;
      sidecar?: { id: string; version: number };
      surfaceUrl?: string;
    };
    expect(receipt).toMatchObject({
      status: 'ready',
      sidecar: { version: 1 },
      surfaceUrl: expect.stringContaining('/canvas?sidecar='),
    });
    expect(receipt).not.toHaveProperty('reasonCode');

    const sidecarResponse = await fetch(
      `${SCENARIO_BASE}/api/presentation/sidecar?sidecarId=${encodeURIComponent(receipt.sidecar!.id)}`,
    );
    const sidecarBody = await sidecarResponse.text();
    expect(sidecarResponse.ok, `${sidecarResponse.status}: ${sidecarBody}`).toBe(true);
    const sidecar = JSON.parse(sidecarBody) as SidecarResponse;
    expect(sidecar.sidecar.key).toEqual(key);
    expect(sidecar.sidecar.surface.root).toMatchObject({
      kind: 'layout',
      children: [
        { kind: 'slot', name: 'waiting-for-me' },
        { kind: 'slot', name: 'in-motion' },
        { kind: 'slot', name: 'work-lines' },
      ],
    });

    const bindings: Array<{
      nodeId: string;
      name: string;
      binding: Exclude<SurfaceBinding, { kind: 'item' }>;
    }> = [];
    const repeats: Array<{ nodeId: string; subject: string }> = [];
    walk(sidecar.sidecar.surface.root, (node) => {
      if (node.kind === 'repeat') repeats.push({ nodeId: node.id, subject: node.source.subject });
      if (node.kind === 'word') {
        for (const [name, binding] of Object.entries(node.bindings)) {
          expect(binding).toEqual(expect.objectContaining({ kind: expect.any(String) }));
          expect(binding).not.toHaveProperty('value');
          if (binding.kind !== 'item') bindings.push({ nodeId: node.id, name, binding });
        }
      }
    });
    expect(new Set(bindings.map(({ binding }) => binding.subject))).toEqual(
      new Set(['inbox', 'delegations', 'threads']),
    );

    const entities = new Map<string, SirenEntity>();
    for (const rel of ['inbox', 'delegations', 'threads']) {
      const entityResponse = await fetch(
        `${SCENARIO_BASE}/api/entity?rel=${encodeURIComponent(rel)}`,
      );
      expect(entityResponse.ok).toBe(true);
      entities.set(rel, (await entityResponse.json()) as SirenEntity);
    }

    const hydrated = hydratePresentationSurface(key.subject as string, sidecar.sidecar.surface, [
      ...entities.values(),
    ]);
    expect(hydrated.bundle.issues).toEqual([]);
    const dataMessage = hydrated.bundle.messages.find((message) => 'updateDataModel' in message);
    if (dataMessage === undefined || !('updateDataModel' in dataMessage)) {
      throw new Error('Canvas hydration did not emit an A2UI data model');
    }
    const hydration = dataMessage.updateDataModel.value as {
      values: Record<string, Record<string, unknown>>;
      repeats: Record<string, unknown>;
    };
    const comparedPropertySubjects = new Set<string>();
    for (const { nodeId, name, binding } of bindings) {
      if (binding.kind !== 'property') continue;
      const snapshotValue = readPath(entities.get(binding.subject), binding.path);
      expect(snapshotValue, `${binding.subject}:${binding.path}`).not.toBeUndefined();
      expect(hydration.values[nodeId]?.[name]).toEqual(snapshotValue);
      comparedPropertySubjects.add(binding.subject);
    }
    expect(comparedPropertySubjects).toEqual(new Set(['inbox', 'delegations', 'threads']));
    for (const repeat of repeats) {
      expect(hydration.repeats[repeat.nodeId]).toEqual(entities.get(repeat.subject)?.entities);
    }

    await page.goto(receipt.surfaceUrl!);
    await expect(page.locator('[data-surface]')).toHaveCount(1);
    await expect(page.locator('[data-testid="canvas-errors"]')).toHaveCount(0);
    // T33:区域 self 链接标签优先合同 title(在等我/在动/我的工作线),rel 退居 href。
    const regionTitles: Record<string, string> = {
      inbox: '在等我',
      delegations: '在动',
      threads: '我的工作线',
    };
    for (const [rel, title] of Object.entries(regionTitles)) {
      expect(entities.get(rel)?.properties.rel).toBe(rel);
      const renderedFact = page.getByText(title, { exact: true });
      expect(await renderedFact.count()).toBeGreaterThan(0);
      await expect(renderedFact.first()).toBeVisible();
      const relLink = page.locator(
        `[data-surface] a[href="/entity?rel=${encodeURIComponent(rel)}"]`,
      );
      expect(await relLink.count()).toBeGreaterThan(0);
      await expect(relLink.first()).toBeVisible();
    }

    const presentationBefore = await loadPresentationSnapshot(pool);
    const aggregateBefore = await findActiveSidecar(pool, key);
    expect(aggregateBefore).toBeDefined();
    expect(contentVersion(fold(await readLog(pool), { flows: businessFlows }))).toBe(
      businessBefore,
    );
    expect(
      (await listEvents(pool)).filter(({ domain }) => domain === 'presentation').length,
    ).toBeGreaterThan(0);

    await pool.query('TRUNCATE presentation_user_sidecars');
    await rebuildPresentationProjection(pool);

    expect(await loadPresentationSnapshot(pool)).toEqual(presentationBefore);
    expect(await findActiveSidecar(pool, key)).toEqual(aggregateBefore);
    expect(contentVersion(fold(await readLog(pool), { flows: businessFlows }))).toBe(
      businessBefore,
    );
    const replayed = await fetch(
      `${SCENARIO_BASE}/api/presentation/sidecar?sidecarId=${encodeURIComponent(receipt.sidecar!.id)}`,
    );
    expect(replayed.ok).toBe(true);
    expect((await replayed.json()) as SidecarResponse).toEqual(sidecar);
  });
});
