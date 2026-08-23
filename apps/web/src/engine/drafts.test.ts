import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion } from '@ui4a/engine';
import type { FlowDefinition } from '@ui4a/shared';

import { ensureDraftTables } from '../db/drafts';
import { ensureEventsTable } from '../db/events';
import { getPool } from '../db/pool';
import { getEngine, resetEngineForTests } from './service';
import { executeDraftMeta, getDraftMetaEntity } from './drafts';

const pool = getPool(process.env.DATABASE_URL!);

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
});

describe('governed Flow Draft vertical slice', () => {
  it('rejects target and request scopes outside credential policy scope', async () => {
    const engine = await getEngine(pool);
    const request = {
      rel: 'meta/drafts',
      action: 'create',
      actor: 'agent' as const,
      principal: 'user:mike',
      channel: 'cli',
      params: {
        kind: 'flow-definition',
        target: 'comment-moderation',
        policyScope: 'publishing',
        commandId: 'scope-mismatch',
        payload: { name: 'comment-moderation' },
      },
    };
    await expect(
      executeDraftMeta(pool, engine, request, { policyScope: 'community' }),
    ).resolves.toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    await expect(
      executeDraftMeta(pool, engine, request, { policyScope: 'publishing' }),
    ).resolves.toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
  });

  it('keeps invalid/ready/pending candidates out of Active and applies only human approval', async () => {
    const engine = await getEngine(pool);
    const active = await engine.readSnapshot();
    const current = active.definitionVersions?.['post-status']?.[1] as FlowDefinition;
    const beforeHash = contentVersion(active);
    const beforeSitemap = engine.getSitemap().version;

    const created = await executeDraftMeta(
      pool,
      engine,
      {
        rel: 'meta/drafts',
        action: 'create',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: {
          kind: 'flow-definition',
          target: 'post-status',
          policyScope: 'publishing',
          commandId: 'create:d1',
          payload: { name: 'post-status' },
        },
      },
      { policyScope: 'publishing' },
    );
    expect(created.kind).toBe('accepted');
    const draftRel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';
    expect(created.kind === 'accepted' && created.entity.properties.status).toBe('invalid');
    expect(contentVersion((await getEngine(pool)).getSnapshot())).toBe(beforeHash);

    const candidate = { ...current, title: 'Improved post lifecycle' };
    const revised = await executeDraftMeta(
      pool,
      engine,
      {
        rel: draftRel,
        action: 'revise',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { commandId: 'revise:d1', baseVersion: 1, payload: candidate },
      },
      { policyScope: 'publishing' },
    );
    expect(revised.kind === 'accepted' && revised.entity.properties.status).toBe('ready');

    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel: draftRel,
        action: 'submit',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { commandId: 'submit:d1' },
      },
      { policyScope: 'publishing' },
    );
    expect(submitted.kind === 'accepted' && submitted.entity.properties.status).toBe(
      'pending-approval',
    );
    const activation = String(
      submitted.kind === 'accepted' ? submitted.entity.properties.activation : '',
    );
    expect(contentVersion((await getEngine(pool)).getSnapshot())).toBe(beforeHash);
    expect(engine.getSitemap().version).toBe(beforeSitemap);

    const denied = await executeDraftMeta(
      pool,
      engine,
      {
        rel: activation,
        action: 'approve',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { commandId: 'approve:agent' },
      },
      { policyScope: 'publishing' },
    );
    expect(denied).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });

    const approved = await executeDraftMeta(
      pool,
      engine,
      {
        rel: activation,
        action: 'approve',
        actor: 'human',
        principal: 'user:mike',
        channel: 'human-renderer',
        params: { commandId: 'approve:human' },
      },
      { policyScope: 'publishing' },
    );
    expect(approved.kind).toBe('accepted');
    await engine.readSnapshot();
    expect(engine.getSnapshot().definitions?.['post-status']).toMatchObject({
      version: 2,
      definition: { title: 'Improved post lifecycle' },
    });
    expect(engine.getSnapshot().instances['post:first-post']?.bornVersion).toBe(1);
    expect(engine.getSitemap().version).not.toBe(beforeSitemap);
    expect(
      (await getDraftMetaEntity(pool, engine, draftRel, 'user:mike', 'publishing'))?.properties,
    ).toMatchObject({ status: 'accepted' });
  });
});
