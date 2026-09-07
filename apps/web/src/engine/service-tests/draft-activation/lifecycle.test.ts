import { beforeEach, expect, it } from 'vitest';
import { fold, type ExecRequest } from '@ui4a/engine';
import { ensureDraftTables, getDraftByOwner } from '@ui4a/db/drafts';
import { ensureEventsTable, listEvents, readLog } from '@ui4a/db/events';
import { getPool } from '@ui4a/db/pool';
import { getEngine, resetEngineForTests } from '../../service';
import { executeDraftMeta } from '../../drafts/drafts';

const pool = getPool(process.env.DATABASE_URL!);
const owner = 'user:lifecycle-review';
beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
});

it('rejects approval against an edited lifecycle before committing either accepted event', async () => {
  const engine = await getEngine(pool);
  const definition = engine.getSnapshot().definitionVersions!['post-status']![1]!;
  const meta = (request: Partial<ExecRequest> & Pick<ExecRequest, 'rel' | 'action'>) =>
    executeDraftMeta(
      pool,
      engine,
      {
        actor: 'human',
        principal: owner,
        channel: 'human-renderer',
        ...request,
      },
      { policyScope: 'publishing' },
    );
  const created = await meta({
    rel: 'meta/drafts',
    action: 'create',
    params: {
      commandId: 'lifecycle:create',
      kind: 'flow-definition',
      target: 'post-status',
      payload: { ...definition, title: 'Reviewed candidate' },
    },
  });
  expect(created.kind).toBe('accepted');
  if (created.kind !== 'accepted') throw new Error('create failed');
  const rel = String(created.entity.properties.rel);
  const submitted = await meta({
    rel,
    action: 'submit',
    params: { commandId: 'lifecycle:submit' },
  });
  expect(submitted.kind).toBe('accepted');
  if (submitted.kind !== 'accepted') throw new Error('submit failed');
  await engine.exec({
    rel: 'meta/flow:post-status',
    action: 'revise',
    actor: 'human',
    principal: owner,
  });
  expect(engine.getSnapshot().instances['meta/flow:post-status']?.node).toBe('draft');
  const edited = await engine.exec({
    rel: 'meta/flow:post-status',
    action: 'add-action',
    actor: 'human',
    principal: owner,
    params: {
      node: 'published',
      action: { name: 'draft-only', title: 'Unapproved change', to: 'archived' },
    },
  });
  expect(edited.kind).toBe('accepted');
  const response = await meta({
    rel: String(submitted.entity.properties.activation),
    action: 'approve',
    params: { commandId: 'lifecycle:approve' },
  });
  expect(response).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
  const events = await listEvents(pool);
  expect(
    events.filter(
      (event) => event.kind === 'definition-candidate-applied' || event.kind === 'draft-accepted',
    ),
  ).toEqual([]);
  expect(events.filter((event) => event.kind === 'action-rejected').at(-1)?.reason).toContain(
    'lifecycle is not active',
  );
  expect((await getDraftByOwner(pool, rel.slice('draft:'.length), owner))?.aggregate.status).toBe(
    'pending-approval',
  );
  expect(await engine.readSnapshot()).toEqual(fold(await readLog(pool), { flows: {} }));
  resetEngineForTests();
  expect((await getEngine(pool)).getSnapshot().instances['meta/flow:post-status']?.node).toBe(
    'draft',
  );
});
