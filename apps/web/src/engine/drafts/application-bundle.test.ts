import { beforeEach, describe, expect, it } from 'vitest';

import { ensureDraftTables, getDraft } from '@ui4a/db/drafts';
import { appendEvent, ensureEventsTable, listEvents } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';

import { getEngine, resetEngineForTests } from '../service';
import { executeDraftMeta, getDraftMetaEntity } from './drafts';

// T48 Phase 1 / T1.2–T1.4:application-bundle Draft 的 apps/web 合同层。
// 覆盖 create(合法/非法 payload/guard 拒绝留痕)、revise 重算、validate 重算与
// stale、inventory 机械 diff、submit;激活(approve)是 Phase 2,本套件只固定
// 现状边界(unsupported Draft kind)。
const pool = getPool(process.env.DATABASE_URL!);
const OWNER = 'user:mike';
const SCOPE = 'development';
const SCHEMA_REF = 'ui4a://application-bundle/v1';

function bundlePayload(bundleName = 'demo-bundle'): Record<string, unknown> {
  return {
    schema: 'https://ui4a.dev/application-bundle/v1',
    bundle: { name: bundleName, version: 1 },
    applications: [
      { name: bundleName, title: 'Demo', intent: 'Demonstrate a governed bundle installation' },
    ],
    capabilities: [],
    flows: [
      {
        name: `${bundleName}-entry`,
        title: 'Demo entry',
        app: bundleName,
        initial: 'start',
        nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
        fields: [],
      },
    ],
    seed: { rel: `seed:${bundleName}`, detail: { instances: {} } },
  };
}

let engine: Awaited<ReturnType<typeof getEngine>>;

function bundleCreate(bundleName: string, commandId: string, payload: unknown, target?: string) {
  return executeDraftMeta(
    pool,
    engine,
    {
      rel: 'meta/drafts',
      action: 'create',
      actor: 'agent',
      principal: OWNER,
      channel: 'cli',
      params: {
        kind: 'application-bundle',
        target: target ?? bundleName,
        commandId,
        payload,
      },
    },
    { policyScope: SCOPE },
  );
}

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
  engine = await getEngine(pool);
});

function draftRelOf(outcome: Awaited<ReturnType<typeof executeDraftMeta>>): string {
  expect(outcome.kind).toBe('accepted');
  return outcome.kind === 'accepted' ? String(outcome.entity.properties.rel) : '';
}

describe('governed application-bundle Draft contract', () => {
  it('publishes the create action with all three Draft kinds', async () => {
    const collection = await getDraftMetaEntity(pool, engine, 'meta/drafts', OWNER, SCOPE);
    const create = collection?.actions.find((candidate) => candidate.name === 'create');
    expect(create?.fields).toMatchObject({
      properties: {
        kind: {
          type: 'string',
          enum: ['flow-definition', 'agent-definition', 'application-bundle'],
        },
      },
    });
  });

  it('creates a ready Draft with inventory diff and mechanical checks', async () => {
    const created = await bundleCreate('demo-bundle', 'bundle:create', bundlePayload());
    expect(created.kind).toBe('accepted');
    expect(created.kind === 'accepted' && created.entity.properties).toMatchObject({
      kind: 'application-bundle',
      target: 'demo-bundle',
      status: 'ready',
      schemaRef: SCHEMA_REF,
      diff: {
        algorithm: 'bundle-inventory',
        bundle: { name: 'demo-bundle', version: 1 },
        added: {
          applications: ['demo-bundle'],
          capabilities: [],
          flows: ['demo-bundle-entry'],
        },
        conflicts: { applications: [], capabilities: [], flows: [] },
      },
      checks: [
        { name: 'bundle-parseable', pass: true },
        { name: 'target-name-match', pass: true },
        { name: 'application-not-installed', pass: true },
      ],
    });
    expect(created.kind === 'accepted' && created.entity.properties.baseVersion).toBeUndefined();
    expect((await getDraft(pool, draftIdOf(created), OWNER, SCOPE))?.aggregate).toMatchObject({
      kind: 'application-bundle',
      target: 'demo-bundle',
      status: 'ready',
    });
  });

  it('keeps an unparseable payload in the Draft with persisted issues', async () => {
    const created = await bundleCreate('demo-bundle', 'bundle:create:invalid', {
      schema: 'https://example.com/not-a-bundle',
    });
    expect(created.kind).toBe('accepted');
    expect(created.kind === 'accepted' && created.entity.properties).toMatchObject({
      status: 'invalid',
      validation: {
        valid: false,
        issues: [{ code: 'parse-error', path: '/' }],
      },
      checks: [
        { name: 'bundle-parseable', pass: false },
        { name: 'target-name-match', pass: false },
        { name: 'application-not-installed', pass: true },
      ],
    });
  });

  it('rejects a target that names an already installed application, audited as an event', async () => {
    const before = (await listEvents(pool)).filter(({ kind }) => kind === 'action-rejected');
    const conflict = await bundleCreate(
      'publishing',
      'bundle:create:conflict',
      bundlePayload('publishing'),
    );
    expect(conflict).toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
      reason: expect.stringContaining('already installed'),
    });
    const events = (await listEvents(pool)).filter(({ kind }) => kind === 'action-rejected');
    expect(events).toHaveLength(before.length + 1);
    expect(events.at(-1)).toMatchObject({
      rel: 'meta/drafts',
      action: 'create',
      detail: { layer: 'guard-failed', domain: 'draft' },
    });
  });

  it('rejects a target that does not match the parsed bundle name, audited as an event', async () => {
    const mismatch = await bundleCreate(
      'demo-other',
      'bundle:create:mismatch',
      bundlePayload('demo-bundle'),
      'demo-other',
    );
    expect(mismatch).toMatchObject({
      kind: 'rejected',
      layer: 'guard-failed',
      reason: expect.stringContaining('does not match'),
    });
    const events = (await listEvents(pool)).filter(({ kind }) => kind === 'action-rejected');
    expect(events.at(-1)).toMatchObject({ action: 'create', rel: 'meta/drafts' });
  });

  it('revises an invalid Draft to ready and flags a renamed bundle as a mismatch issue', async () => {
    const created = await bundleCreate('demo-bundle', 'bundle:revise:create', {
      schema: 'https://example.com/not-a-bundle',
    });
    const rel = draftRelOf(created);
    const revised = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'revise',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: { commandId: 'bundle:revise:fix', baseVersion: 1, payload: bundlePayload() },
      },
      { policyScope: SCOPE },
    );
    expect(revised.kind === 'accepted' && revised.entity.properties).toMatchObject({
      status: 'ready',
      version: 2,
      validation: { valid: true },
    });

    const renamed = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'revise',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: {
          commandId: 'bundle:revise:rename',
          baseVersion: 2,
          payload: bundlePayload('demo-renamed'),
        },
      },
      { policyScope: SCOPE },
    );
    expect(renamed.kind === 'accepted' && renamed.entity.properties).toMatchObject({
      status: 'invalid',
      validation: {
        valid: false,
        issues: [{ code: 'target-name-mismatch', path: '/bundle/name' }],
      },
    });
  });

  it('recomputes on validate and marks the Draft stale once the target gets installed', async () => {
    const created = await bundleCreate('demo-bundle', 'bundle:validate:create', bundlePayload());
    const rel = draftRelOf(created);

    const revalidated = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'validate',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: { commandId: 'bundle:validate:again' },
      },
      { policyScope: SCOPE },
    );
    expect(revalidated.kind === 'accepted' && revalidated.entity.properties.status).toBe('ready');

    // 双写者口径:另一路径安装了同名 application,validate 必须把 Draft 判 stale。
    await appendEvent(pool, {
      kind: 'application-seeded',
      rel: 'meta/application:demo-bundle',
      actor: 'agent',
      principal: 'system:test',
      channel: 'meta',
      detail: {
        name: 'demo-bundle',
        definition: {
          name: 'demo-bundle',
          title: 'Demo',
          intent: 'Installed by another path',
        },
      },
    });
    await engine.readSnapshot();

    const staled = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'validate',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: { commandId: 'bundle:validate:stale' },
      },
      { policyScope: SCOPE },
    );
    expect(staled.kind === 'accepted' && staled.entity.properties.status).toBe('stale');
    const events = await listEvents(pool);
    expect(events.filter(({ kind }) => kind === 'draft-staled')).toHaveLength(1);
  });

  it('projects the mechanical inventory diff via the diff action', async () => {
    const created = await bundleCreate('demo-bundle', 'bundle:diff:create', bundlePayload());
    const rel = draftRelOf(created);
    const diffed = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'diff',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: {},
      },
      { policyScope: SCOPE },
    );
    expect(diffed.kind === 'accepted' && diffed.entity.properties.diff).toMatchObject({
      algorithm: 'bundle-inventory',
      inventory: {
        applications: ['demo-bundle'],
        flows: ['demo-bundle-entry'],
      },
      added: { applications: ['demo-bundle'], flows: ['demo-bundle-entry'] },
      conflicts: { applications: [], capabilities: [], flows: [] },
    });
  });

  it('submits to pending-approval and keeps human activation a Phase 2 boundary', async () => {
    const created = await bundleCreate('demo-bundle', 'bundle:submit:create', bundlePayload());
    const rel = draftRelOf(created);
    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'submit',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: { commandId: 'bundle:submit' },
      },
      { policyScope: SCOPE },
    );
    expect(submitted.kind === 'accepted' && submitted.entity.properties).toMatchObject({
      status: 'pending-approval',
    });
    const activation = String(
      submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
    );

    const denied = await executeDraftMeta(
      pool,
      engine,
      {
        rel: activation,
        action: 'approve',
        actor: 'agent',
        principal: OWNER,
        channel: 'cli',
        params: { commandId: 'bundle:submit:agent-approve' },
      },
      { policyScope: SCOPE },
    );
    expect(denied).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });

    // Phase 1 边界:application-bundle 的激活分支尚未实现,现状是显式 unsupported。
    await expect(
      executeDraftMeta(
        pool,
        engine,
        {
          rel: activation,
          action: 'approve',
          actor: 'human',
          principal: OWNER,
          channel: 'human-renderer',
          params: { commandId: 'bundle:submit:human-approve' },
        },
        { policyScope: SCOPE },
      ),
    ).rejects.toThrow('unsupported Draft kind');
    expect((await getDraftMetaEntity(pool, engine, rel, OWNER, SCOPE))?.properties.status).toBe(
      'pending-approval',
    );
  });
});

function draftIdOf(outcome: Awaited<ReturnType<typeof executeDraftMeta>>): string {
  expect(outcome.kind).toBe('accepted');
  return outcome.kind === 'accepted' ? String(outcome.entity.properties.id) : '';
}
