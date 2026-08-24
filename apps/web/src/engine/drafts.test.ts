import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion, fold } from '@ui4a/engine';
import type { AgentDefinition, AgentDefinitionRef, FlowDefinition } from '@ui4a/shared';

import { ensureDraftTables, getDraft, rebuildDraftProjection } from '../db/drafts';
import { ensureEventsTable, listEvents, readLog } from '../db/events';
import { getPool } from '../db/pool';
import { businessFlows } from '../domain/flows';
import { getEngine, resetEngineForTests } from './service';
import {
  executeDraftMeta,
  getDraftMetaEntity,
  type AgentDefinitionDraftRegistryPort,
} from './drafts';

const pool = getPool(process.env.DATABASE_URL!);

beforeEach(async () => {
  await ensureEventsTable(pool);
  await ensureDraftTables(pool);
  await pool.query('TRUNCATE draft_projection, draft_payloads, events');
  resetEngineForTests();
});

describe('governed Flow Draft vertical slice', () => {
  it('concurrent human accept/reject has one terminal winner, audited loser, and rebuild parity', async () => {
    const engine = await getEngine(pool);
    const current = engine.getSnapshot().definitionVersions?.['post-status']?.[1] as FlowDefinition;
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
          commandId: 'concurrent:create',
          payload: { name: 'post-status' },
        },
      },
      { policyScope: 'publishing' },
    );
    expect(created.kind).toBe('accepted');
    const draftRel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';
    await executeDraftMeta(
      pool,
      engine,
      {
        rel: draftRel,
        action: 'revise',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: {
          commandId: 'concurrent:revise',
          baseVersion: 1,
          payload: { ...current, title: 'Concurrent candidate' },
        },
      },
      { policyScope: 'publishing' },
    );
    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel: draftRel,
        action: 'submit',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { commandId: 'concurrent:submit' },
      },
      { policyScope: 'publishing' },
    );
    expect(submitted.kind).toBe('accepted');
    const activation =
      submitted.kind === 'accepted' ? String(submitted.entity.properties.activation) : '';

    const settled = await Promise.allSettled([
      executeDraftMeta(
        pool,
        engine,
        {
          rel: activation,
          action: 'approve',
          actor: 'human',
          principal: 'user:mike',
          channel: 'human-renderer',
          params: { commandId: 'concurrent:approve' },
        },
        { policyScope: 'publishing' },
      ),
      executeDraftMeta(
        pool,
        engine,
        {
          rel: activation,
          action: 'reject',
          actor: 'human',
          principal: 'user:mike',
          channel: 'human-renderer',
          params: { commandId: 'concurrent:reject', reason: 'concurrent loser' },
        },
        { policyScope: 'publishing' },
      ),
    ]);

    expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(0);
    const outcomes = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(outcomes.filter(({ kind }) => kind === 'accepted')).toHaveLength(1);
    expect(outcomes.filter(({ kind }) => kind === 'rejected')).toHaveLength(1);

    const events = await listEvents(pool);
    expect(
      events.filter(({ kind }) => kind === 'draft-accepted' || kind === 'draft-rejected'),
    ).toHaveLength(1);
    expect(events.filter(({ kind }) => kind === 'action-rejected')).toHaveLength(1);
    const stored = await getDraft(pool, draftRel.slice('draft:'.length), 'user:mike', 'publishing');
    expect(stored?.aggregate.status).toMatch(/accepted|rejected/);
    const beforeRebuild = stored?.aggregate;
    await pool.query('TRUNCATE draft_projection');
    await rebuildDraftProjection(pool);
    expect(
      (await getDraft(pool, draftRel.slice('draft:'.length), 'user:mike', 'publishing'))?.aggregate,
    ).toEqual(beforeRebuild);
    await engine.readSnapshot();
    expect(contentVersion(engine.getSnapshot())).toBe(
      contentVersion(fold(await readLog(pool), { flows: businessFlows })),
    );
  });

  it('concurrent agent abandon has one terminal winner and one audited guard loser', async () => {
    const engine = await getEngine(pool);
    const created = await executeDraftMeta(
      pool,
      engine,
      {
        rel: 'meta/drafts',
        action: 'create',
        actor: 'agent',
        principal: 'agent:replay-drill',
        channel: 'oidc',
        params: {
          kind: 'flow-definition',
          target: 'post-status',
          policyScope: 'publishing',
          commandId: 'replay-drill:create',
          payload: { name: 'post-status' },
        },
      },
      { policyScope: 'publishing' },
    );
    expect(created.kind).toBe('accepted');
    const draftRel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';

    const settled = await Promise.allSettled([
      executeDraftMeta(
        pool,
        engine,
        {
          rel: draftRel,
          action: 'abandon',
          actor: 'agent',
          principal: 'agent:replay-drill',
          channel: 'oidc',
          params: { commandId: 'replay-drill:abandon-a', reason: 'race fixture a' },
        },
        { policyScope: 'publishing' },
      ),
      executeDraftMeta(
        pool,
        engine,
        {
          rel: draftRel,
          action: 'abandon',
          actor: 'agent',
          principal: 'agent:replay-drill',
          channel: 'oidc',
          params: { commandId: 'replay-drill:abandon-b', reason: 'race fixture b' },
        },
        { policyScope: 'publishing' },
      ),
    ]);

    expect(settled.every(({ status }) => status === 'fulfilled')).toBe(true);
    const outcomes = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    expect(outcomes.filter(({ kind }) => kind === 'accepted')).toHaveLength(1);
    expect(outcomes.filter(({ kind }) => kind === 'rejected')).toEqual([
      expect.objectContaining({ kind: 'rejected', layer: 'guard-failed' }),
    ]);
    const events = await listEvents(pool);
    expect(events.filter(({ kind }) => kind === 'draft-abandoned')).toHaveLength(1);
    expect(
      events.filter(
        ({ kind, rel, action }) =>
          kind === 'action-rejected' && rel === draftRel && action === 'abandon',
      ),
    ).toHaveLength(1);
    expect(
      (await getDraft(pool, draftRel.slice('draft:'.length), 'agent:replay-drill', 'publishing'))
        ?.aggregate.status,
    ).toBe('abandoned');
  });

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

function baseAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    schemaVersion: 1,
    ref: 'base-agent@1',
    name: 'base-agent',
    version: 1,
    intent: 'Complete authorized work',
    prompt: {
      schemaVersion: 1,
      blocks: [
        {
          id: 'authority',
          role: 'system',
          purpose: 'authority',
          literal: 'Stay within grants.',
          sealed: true,
        },
        {
          id: 'objective',
          role: 'user',
          purpose: 'task-data',
          binding: {
            source: 'task',
            pointer: '/objective',
            encoding: 'json-delimited',
            required: true,
          },
        },
      ],
    },
    contracts: {
      inputSchema: {
        type: 'object',
        properties: { objective: { type: 'string' } },
      },
      outputSchema: { type: 'object' },
    },
    runtimeRequirements: { class: 'general-agent', features: ['streaming'] },
    policies: {
      tools: { allowed: ['read'] },
      context: { allowedSources: ['entity'], maxItems: 20 },
      resources: { allowed: ['entity'] },
      artifacts: { allowedMediaTypes: ['text/plain'], maxCount: 5, maxBytes: 10_000 },
    },
    evaluationPolicy: { verifiers: ['schema'], evalSuiteRefs: ['eval:base@1'] },
    ...overrides,
  };
}

function agentDefinitionPort(): AgentDefinitionDraftRegistryPort & {
  activeByName: Map<string, AgentDefinitionRef>;
  activations: unknown[];
  projectionSeqs: number[][];
} {
  const active = baseAgent();
  const definitions = new Map([[active.ref, { status: 'active' as const, source: active }]]);
  const activeByName = new Map([['base-agent', active.ref]]);
  const activations: unknown[] = [];
  const projectionSeqs: number[][] = [];
  return {
    activeByName,
    activations,
    projectionSeqs,
    async readSnapshot() {
      return {
        definitions,
        activeByName,
        activationRegistries: {
          runtimeClasses: new Map([['general-agent', new Set(['streaming'])]]),
          tools: new Set(['read']),
          resources: new Set(['entity']),
          contextSources: new Set(['entity']),
          verifiers: new Set(['schema']),
          evalEvidence: new Map([
            ['eval:base@1', { passed: true, score: 1, artifactHash: `sha256:${'a'.repeat(64)}` }],
          ]),
        },
        evalEvidencePayloads: new Map([
          [
            'eval:base@1',
            {
              suiteRef: 'eval:base@1',
              passed: true,
              score: 1,
              artifactHash: `sha256:${'a'.repeat(64)}`,
            },
          ],
        ]),
      };
    },
    async prepareAtomicActivation(input) {
      activations.push(input);
      return {
        events: [
          {
            domain: 'agent-definition',
            kind: 'agent-definition-version-registered',
            rel: `meta/agent-definition:${input.artifact.ref}`,
            actor: 'human',
            principal: input.decidedBy.principal,
            detail: { draftId: input.draftId, flattenedHash: input.artifact.flattenedHash },
          },
          {
            domain: 'agent-definition',
            kind: 'agent-definition-version-activated',
            rel: `meta/agent-definition:${input.artifact.ref}`,
            actor: 'human',
            principal: input.decidedBy.principal,
            detail: { draftId: input.draftId, ref: input.artifact.ref },
          },
        ],
        async applyProjection({ seqs }) {
          projectionSeqs.push(seqs);
        },
      };
    },
  };
}

describe('governed Agent Definition Draft vertical slice', () => {
  it('creates invalid candidates, revises them to ready and exposes authored/effective diff', async () => {
    const engine = await getEngine(pool);
    const registry = agentDefinitionPort();
    const context = { policyScope: 'development', agentDefinitions: registry };
    const invalid = await executeDraftMeta(
      pool,
      engine,
      {
        rel: 'meta/drafts',
        action: 'create',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: {
          kind: 'agent-definition',
          target: 'review-agent',
          policyScope: 'development',
          commandId: 'agent:create',
          payload: { name: 'review-agent' },
        },
      },
      context,
    );
    expect(invalid.kind === 'accepted' && invalid.entity.properties.status).toBe('invalid');
    const rel = invalid.kind === 'accepted' ? String(invalid.entity.properties.rel) : '';

    const candidate = baseAgent({
      ref: 'review-agent@1',
      name: 'review-agent',
      intent: 'Review a governed work product',
    });
    const revised = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'revise',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { commandId: 'agent:revise', baseVersion: 1, payload: candidate },
      },
      context,
    );
    expect(revised.kind === 'accepted' && revised.entity.properties).toMatchObject({
      status: 'ready',
      diff: {
        authored: { before: null, after: { ref: 'review-agent@1' } },
        effective: { before: null, after: { ref: 'review-agent@1' } },
      },
    });
    expect(
      await getDraftMetaEntity(pool, engine, rel, 'user:other', 'development', registry),
    ).toBeUndefined();
  });

  it('rejects Agent and system self-approval then atomically hands a human decision to the registry port', async () => {
    const engine = await getEngine(pool);
    const registry = agentDefinitionPort();
    const context = { policyScope: 'development', agentDefinitions: registry };
    const candidate = baseAgent({ ref: 'review-agent@1', name: 'review-agent' });
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
          kind: 'agent-definition',
          target: 'review-agent',
          policyScope: 'development',
          commandId: 'agent:approval:create',
          payload: candidate,
        },
      },
      context,
    );
    const rel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';
    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'submit',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { commandId: 'agent:approval:submit' },
      },
      context,
    );
    const activation =
      submitted.kind === 'accepted' ? String(submitted.entity.properties.activation) : '';

    for (const actor of ['agent', 'system'] as const) {
      const denied = await executeDraftMeta(
        pool,
        engine,
        {
          rel: activation,
          action: 'approve',
          actor: actor as 'agent',
          principal: 'user:mike',
          channel: 'cli',
          params: { commandId: `agent:approval:${actor}` },
        },
        context,
      );
      expect(denied).toMatchObject({ kind: 'rejected', reason: 'actor-is-human=false' });
    }

    const approved = await executeDraftMeta(
      pool,
      engine,
      {
        rel: activation,
        action: 'approve',
        actor: 'human',
        principal: 'user:mike',
        channel: 'human-renderer',
        params: { commandId: 'agent:approval:human' },
      },
      context,
    );
    expect(approved.kind === 'accepted' && approved.entity.properties.status).toBe('accepted');
    expect(registry.activations).toHaveLength(1);
    expect(registry.activations[0]).toMatchObject({
      source: { ref: 'review-agent@1' },
      artifact: { ref: 'review-agent@1' },
      evalEvidence: {
        refs: ['eval:base@1'],
        payloads: { 'eval:base@1': { passed: true, score: 1 } },
      },
      requestedBy: { actor: 'agent', principal: 'user:mike' },
      decidedBy: { actor: 'human', principal: 'user:mike' },
      diff: { authored: { before: null }, effective: { before: null } },
    });
    expect(registry.projectionSeqs).toHaveLength(1);
    expect(registry.projectionSeqs[0]).toHaveLength(2);
    const events = await pool.query<{ kind: string }>(
      `SELECT kind FROM events
       WHERE kind IN (
         'agent-definition-version-registered',
         'agent-definition-version-activated',
         'draft-accepted'
       ) AND principal='user:mike' ORDER BY seq`,
    );
    expect(events.rows.map((row) => row.kind)).toEqual([
      'agent-definition-version-registered',
      'agent-definition-version-activated',
      'draft-accepted',
    ]);
  });

  it('fails closed and marks the Draft stale when the active base changes before approval', async () => {
    const engine = await getEngine(pool);
    const registry = agentDefinitionPort();
    const context = { policyScope: 'development', agentDefinitions: registry };
    const candidate = baseAgent({
      ref: 'base-agent@2',
      version: 2,
      intent: 'Updated intent',
    });
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
          kind: 'agent-definition',
          target: 'base-agent',
          policyScope: 'development',
          commandId: 'agent:stale:create',
          payload: candidate,
        },
      },
      context,
    );
    const rel = created.kind === 'accepted' ? String(created.entity.properties.rel) : '';
    const submitted = await executeDraftMeta(
      pool,
      engine,
      {
        rel,
        action: 'submit',
        actor: 'agent',
        principal: 'user:mike',
        channel: 'cli',
        params: { commandId: 'agent:stale:submit' },
      },
      context,
    );
    const activation =
      submitted.kind === 'accepted' ? String(submitted.entity.properties.activation) : '';
    registry.activeByName.set('base-agent', 'base-agent@2');

    await expect(
      executeDraftMeta(
        pool,
        engine,
        {
          rel: activation,
          action: 'approve',
          actor: 'human',
          principal: 'user:mike',
          channel: 'human-renderer',
          params: { commandId: 'agent:stale:approve' },
        },
        context,
      ),
    ).rejects.toThrow('stale');
    expect(
      (await getDraftMetaEntity(pool, engine, rel, 'user:mike', 'development', registry))
        ?.properties.status,
    ).toBe('stale');
    expect(registry.activations).toHaveLength(0);
  });
});
