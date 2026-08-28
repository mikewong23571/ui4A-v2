import { beforeEach, describe, expect, it } from 'vitest';

import { contentVersion } from '@ui4a/engine';
import { completePresentationRequest } from '@ui4a/shared';

import {
  appendSidecarCommand,
  ensurePresentationTables,
  findActiveSidecar,
} from '@ui4a/db/presentation';
import { appendEvent, listEvents } from '@ui4a/db/events';
import { getDb, getEngine, resetEngineForTests } from '../service';
import { getPresentationBroker, resetPresentationBrokerForTests } from './runtime';
import { resetRecipeCoordinatorForTests } from './recipes-runtime';
import { PRESENTATION_SURFACE_CATALOG } from './catalog';
import { getBuiltinComposition } from './compositions';
import { planWorkspaceComposition } from './runtime-composition';

beforeEach(async () => {
  await ensurePresentationTables(getDb());
  await getDb().query('TRUNCATE events, presentation_user_sidecars');
  resetEngineForTests();
  resetPresentationBrokerForTests();
  resetRecipeCoordinatorForTests();
});

describe('durable user Sidecar fastpath', () => {
  it('composes my-work as one ordered three-region binding-only Sidecar without an LLM', async () => {
    const engine = await getEngine(getDb());
    const beforeHash = contentVersion(engine.getSnapshot());
    const beforeCoreCount = (await listEvents(getDb())).filter(
      (event) => event.domain !== 'presentation',
    ).length;
    const request = completePresentationRequest(
      { subject: 'workspace:my-work', intent: 'work overview', delivery: 'canvas' },
      { requestId: 'workspace:full', principal: 'local-user', sourceMessageIds: [] },
    );

    const receipt = await getPresentationBroker().present(request);
    expect(receipt).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
    const sidecar = await findActiveSidecar(getDb(), {
      principal: 'local-user',
      subject: 'workspace:my-work',
      intent: 'work overview',
      deviceClass: 'any',
    });
    const surface = sidecar!.versions[sidecar!.activeVersion]!.surface;
    expect(surface.root).toMatchObject({
      kind: 'layout',
      children: [
        { kind: 'slot', name: 'waiting-for-me' },
        { kind: 'slot', name: 'in-motion' },
        { kind: 'slot', name: 'work-lines' },
      ],
    });
    expect(JSON.stringify(surface)).not.toMatch(/"value":"(?:inbox|delegations|threads)"/);
    expect(
      sidecar!.versions[sidecar!.activeVersion]!.dependencies.filter(
        (dependency) => dependency.kind === 'entity-contract',
      ),
    ).toHaveLength(3);
    expect(contentVersion((await getEngine(getDb())).getSnapshot())).toBe(beforeHash);
    expect(
      (await listEvents(getDb())).filter((event) => event.domain !== 'presentation'),
    ).toHaveLength(beforeCoreCount);
  });

  it('derives the publishing app workspace composition from the live sitemap (T37 FR3)', async () => {
    const engine = await getEngine(getDb());
    const beforeHash = contentVersion(engine.getSnapshot());
    const beforeCoreCount = (await listEvents(getDb())).filter(
      (event) => event.domain !== 'presentation',
    ).length;
    const request = completePresentationRequest(
      { subject: 'workspace:app:publishing', intent: 'app overview', delivery: 'canvas' },
      { requestId: 'app-workspace:publishing', principal: 'local-user', sourceMessageIds: [] },
    );

    const receipt = await getPresentationBroker().present(request);
    expect(receipt).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
    const sidecar = await findActiveSidecar(getDb(), {
      principal: 'local-user',
      subject: 'workspace:app:publishing',
      intent: 'app overview',
      deviceClass: 'any',
    });
    const active = sidecar!.versions[sidecar!.activeVersion]!;
    expect(active.surface.root).toMatchObject({
      kind: 'layout',
      children: [
        { kind: 'slot', name: 'articles' },
        { kind: 'slot', name: 'article-drafting' },
      ],
    });
    expect(
      active.dependencies
        .filter((dependency) => dependency.kind === 'entity-contract')
        .map((dependency) => dependency.ref),
    ).toEqual(['articles', 'flow:article-drafting']);
    // 组合不产生真相:零业务事件、快照 hash 不变(虚主体不可 exec、零新事件类型)。
    expect(contentVersion((await getEngine(getDb())).getSnapshot())).toBe(beforeHash);
    expect(
      (await listEvents(getDb())).filter((event) => event.domain !== 'presentation'),
    ).toHaveLength(beforeCoreCount);
  });

  it('rejects unknown app workspace scopes honestly without fabricating a declaration (T37)', async () => {
    const receipt = await getPresentationBroker().present(
      completePresentationRequest(
        { subject: 'workspace:app:nonexistent', intent: 'app overview', delivery: 'canvas' },
        { requestId: 'app-workspace:missing', principal: 'local-user', sourceMessageIds: [] },
      ),
    );
    expect(receipt).toMatchObject({ status: 'failed', reasonCode: 'authorization-failed' });
    await expect(
      findActiveSidecar(getDb(), {
        principal: 'local-user',
        subject: 'workspace:app:nonexistent',
        intent: 'app overview',
        deviceClass: 'any',
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['community', ['comments'], ['comments']],
    ['todo', ['todos', 'todo-capture'], ['todos', 'flow:todo-capture']],
  ] as const)(
    'derives the %s app workspace face from the same sitemap machinery (T37 zero per-app code)',
    async (scope, slotNames, sourceRefs) => {
      const request = completePresentationRequest(
        { subject: `workspace:app:${scope}`, intent: 'app overview', delivery: 'canvas' },
        { requestId: `app-workspace:${scope}`, principal: 'local-user', sourceMessageIds: [] },
      );
      const receipt = await getPresentationBroker().present(request);
      expect(receipt).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
      const sidecar = await findActiveSidecar(getDb(), {
        principal: 'local-user',
        subject: `workspace:app:${scope}`,
        intent: 'app overview',
        deviceClass: 'any',
      });
      const active = sidecar!.versions[sidecar!.activeVersion]!;
      expect(active.surface.root).toMatchObject({
        kind: 'layout',
        children: slotNames.map((name) => ({ kind: 'slot', name })),
      });
      expect(
        active.dependencies
          .filter((dependency) => dependency.kind === 'entity-contract')
          .map((dependency) => dependency.ref),
      ).toEqual(sourceRefs);
    },
  );

  it('persists concurrent same-requestId workspaces independently across principals', async () => {
    const aliceRequest = completePresentationRequest(
      { subject: 'workspace:my-work', intent: 'concurrent overview', delivery: 'canvas' },
      { requestId: 'workspace:same-request', principal: 'user:alice', sourceMessageIds: [] },
    );
    const bobRequest = completePresentationRequest(
      { subject: 'workspace:my-work', intent: 'concurrent overview', delivery: 'canvas' },
      { requestId: 'workspace:same-request', principal: 'user:bob', sourceMessageIds: [] },
    );

    const [alice, bob] = await Promise.all([
      getPresentationBroker().present(aliceRequest),
      getPresentationBroker().present(bobRequest),
    ]);

    expect(alice).toMatchObject({ status: 'ready' });
    expect(alice).not.toHaveProperty('reasonCode');
    expect(bob).toMatchObject({ status: 'ready' });
    expect(bob).not.toHaveProperty('reasonCode');
    // principal 是 durable 键的归属维度:同名 requestId 不串台。
    expect(alice.sidecar?.id).not.toBe(bob.sidecar?.id);
    await expect(
      findActiveSidecar(getDb(), {
        principal: 'user:alice',
        subject: 'workspace:my-work',
        intent: 'concurrent overview',
        deviceClass: 'any',
      }),
    ).resolves.toMatchObject({ id: alice.sidecar!.id });
    await expect(
      findActiveSidecar(getDb(), {
        principal: 'user:bob',
        subject: 'workspace:my-work',
        intent: 'concurrent overview',
        deviceClass: 'any',
      }),
    ).resolves.toMatchObject({ id: bob.sidecar!.id });
    const lifecycle = (await listEvents(getDb())).filter(
      (event) =>
        event.domain === 'presentation' &&
        (event.kind === 'presentation-requested' || event.kind === 'presentation-resolved') &&
        (event.detail as { requestId?: unknown }).requestId === 'workspace:same-request',
    );
    expect(lifecycle.filter((event) => event.kind === 'presentation-requested')).toHaveLength(2);
    expect(lifecycle.filter((event) => event.kind === 'presentation-resolved')).toHaveLength(2);
  });

  it('reuses one durable Sidecar across changing grant envelopes without a second key (D51)', async () => {
    const request = completePresentationRequest(
      { subject: 'post:first-post', intent: 'grant-stable', delivery: 'canvas' },
      { requestId: 'grant-stable:1', principal: 'local-user', sourceMessageIds: [] },
    );

    const first = await getPresentationBroker().present(request);
    // 授予集合变化(如新增/移除 application)不得产生第二份键;同一四元组键上的
    // 授予差异由依赖指纹失效触发重规划。
    const second = await getPresentationBroker().present(request, {
      grantedApplications: ['publishing'],
    });

    expect(first).toMatchObject({ status: 'ready' });
    expect(second).toMatchObject({ status: 'ready' });
    expect(second.sidecar?.id).toBe(first.sidecar?.id);
    await expect(
      findActiveSidecar(getDb(), {
        principal: 'local-user',
        subject: 'post:first-post',
        intent: 'grant-stable',
        deviceClass: 'any',
      }),
    ).resolves.toMatchObject({ id: first.sidecar!.id });
  });

  it('replans in place when a grant-envelope change shifts the policy fingerprint (same key)', async () => {
    const request = completePresentationRequest(
      { subject: 'post:first-post', intent: 'grant-replan', delivery: 'canvas' },
      { requestId: 'grant-replan:1', principal: 'local-user', sourceMessageIds: [] },
    );
    const policyDependencyOf = async (principal: string) => {
      const stored = await findActiveSidecar(getDb(), {
        principal,
        subject: request.subject as string,
        intent: request.intent,
        deviceClass: 'any',
      });
      return stored!.versions[stored!.activeVersion]!.dependencies.find(
        ({ kind }) => kind === 'policy',
      )!;
    };

    const first = await getPresentationBroker().present(request);
    expect(first).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
    // B2:policy 指纹 = 排序后的授予集合;local profile 即 ['local-demo']。
    await expect(policyDependencyOf('local-user')).resolves.toEqual(
      expect.objectContaining({
        id: 'policy:local-demo',
        ref: 'local-demo',
        fingerprint: 'local-demo',
      }),
    );

    const second = await getPresentationBroker().present(request, {
      grantedApplications: ['default', 'publishing'],
    });
    expect(second).toMatchObject({
      status: 'ready',
      sidecar: { id: first.sidecar!.id, version: 2 },
    });
    // 键不变、指纹失效 → dependencyDecision 重规划为最新授予集合指纹。
    await expect(policyDependencyOf('local-user')).resolves.toEqual(
      expect.objectContaining({
        id: 'policy:default|publishing',
        ref: 'default|publishing',
        fingerprint: 'default|publishing',
      }),
    );
    const staled = (await listEvents(getDb())).filter(
      ({ domain, kind }) => domain === 'presentation' && kind === 'user-sidecar-staled',
    );
    expect(staled).toHaveLength(1);
    expect(staled[0]!.detail).toMatchObject({ reason: 'dependency-changed' });
  });

  it('keeps denied regions as non-leaking diagnostics and reports partial authorization', async () => {
    const declaration = getBuiltinComposition('my-work')!;
    const threads = await (await getEngine(getDb())).getEntity('threads');
    const planned = planWorkspaceComposition({
      rels: ['threads'],
      entities: [threads],
      declaration,
      regions: declaration.regions.map((region) => ({
        declaration: region,
        ...(region.source === 'threads' ? { entity: threads } : {}),
      })),
    });
    expect(planned.partial).toBe(true);
    const serialized = JSON.stringify(planned.surface);
    expect(serialized.match(/"code":"region-unavailable"/g)).toHaveLength(2);
    expect(serialized).not.toContain('inbox');
    expect(serialized).not.toContain('delegations');
    expect(
      planned.dependencies.filter((dependency) => dependency.kind === 'entity-contract'),
    ).toHaveLength(1);
  });

  it('returns the same Sidecar across independent Chat requests and leaves Business hash unchanged', async () => {
    const engine = await getEngine(getDb());
    const beforeHash = contentVersion(engine.getSnapshot());
    const intent = { subject: 'post:first-post', intent: 'read', delivery: 'canvas' } as const;
    const started = performance.now();
    const first = await getPresentationBroker().present(
      completePresentationRequest(intent, {
        requestId: 'chat-a:1',
        principal: 'local-user',
        sourceMessageIds: ['message:a'],
      }),
    );
    const firstUsableMs = performance.now() - started;
    const second = await getPresentationBroker().present(
      completePresentationRequest(intent, {
        requestId: 'chat-b:1',
        principal: 'local-user',
        sourceMessageIds: ['message:b'],
      }),
    );

    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    expect(second.sidecar).toEqual(first.sidecar);
    expect(firstUsableMs).toBeLessThan(500);
    expect(second.surfaceUrl).toContain(`sidecar=${encodeURIComponent(first.sidecar!.id)}`);
    await expect(
      findActiveSidecar(getDb(), {
        principal: 'local-user',
        subject: 'post:first-post',
        intent: 'read',
        deviceClass: 'any',
      }),
    ).resolves.toMatchObject({ id: first.sidecar!.id, activeVersion: first.sidecar!.version });
    expect(contentVersion((await getEngine(getDb())).getSnapshot())).toBe(beforeHash);
    const presentationKinds = (await listEvents(getDb()))
      .filter(({ domain }) => domain === 'presentation')
      .map(({ kind }) => kind);
    expect(presentationKinds).toEqual(
      expect.arrayContaining([
        'presentation-requested',
        'presentation-resolved',
        'user-sidecar-instantiated',
      ]),
    );
  });

  it('fails a corrupt Sidecar closed, records it stale, and repairs with generic binding-only output', async () => {
    const intent = { subject: 'post:first-post', intent: 'read', delivery: 'canvas' } as const;
    const first = await getPresentationBroker().present(
      completePresentationRequest(intent, {
        requestId: 'corrupt:seed',
        principal: 'local-user',
        sourceMessageIds: [],
      }),
    );
    expect(first.status).toBe('ready');
    const active = await findActiveSidecar(getDb(), {
      principal: 'local-user',
      subject: 'post:first-post',
      intent: 'read',
      deviceClass: 'any',
    });
    await appendSidecarCommand(getDb(), {
      kind: 'revise',
      eventId: 'corrupt:event',
      commandId: 'corrupt:command',
      sidecarId: active!.id,
      baseVersion: active!.activeVersion,
      version: {
        surface: {
          schemaVersion: 1,
          root: {
            kind: 'word',
            id: 'bad',
            role: 'primary-content',
            word: 'missing-word',
            bindings: {},
            dependencies: [],
            provenance: [{ kind: 'human-patch', ref: 'corrupt-fixture' }],
          },
        },
        dependencies: active!.versions[active!.activeVersion]!.dependencies,
        provenance: { kind: 'human-patch', ref: 'corrupt-fixture' },
        changedPaths: ['/surface'],
      },
    });

    const repaired = await getPresentationBroker().present(
      completePresentationRequest(intent, {
        requestId: 'corrupt:repair',
        principal: 'local-user',
        sourceMessageIds: [],
      }),
    );
    expect(repaired).toMatchObject({ status: 'ready', sidecar: { id: active!.id, version: 3 } });
    const kinds = (await listEvents(getDb()))
      .filter(({ domain }) => domain === 'presentation')
      .map(({ kind }) => kind);
    expect(kinds).toEqual(expect.arrayContaining(['user-sidecar-staled', 'user-sidecar-revised']));
  });

  it('replays a human-promoted Recipe after restart and instantiates it before generic planning', async () => {
    const candidate = {
      key: {
        application: 'runtime',
        applicationVersion: '1',
        scenario: 'human-promoted',
        subjectShape: 'flow-instance:post-status',
        intent: 'review',
        catalogVersion: PRESENTATION_SURFACE_CATALOG.version,
      },
      slots: [{ name: 'subject', kind: 'flow' as const }],
      surfaceTemplate: {
        schemaVersion: 1 as const,
        root: {
          kind: 'layout' as const,
          id: 'root',
          role: 'primary-content' as const,
          layout: 'stack' as const,
          children: [
            {
              kind: 'slot' as const,
              id: 'subject-region',
              role: 'primary-content' as const,
              name: 'subject',
              child: {
                kind: 'word' as const,
                id: 'identity',
                role: 'identity' as const,
                word: 'heading',
                bindings: {
                  value: {
                    kind: 'property' as const,
                    subject: '$slot:subject',
                    path: 'properties.fields.title',
                  },
                },
                dependencies: [
                  {
                    kind: 'entity' as const,
                    subject: '$slot:subject',
                    version: '$runtime',
                    paths: ['properties.fields.title'],
                  },
                  {
                    kind: 'catalog' as const,
                    subject: PRESENTATION_SURFACE_CATALOG.id,
                    version: PRESENTATION_SURFACE_CATALOG.version,
                  },
                ],
                provenance: [{ kind: 'human-patch' as const, ref: 'sidecar:source' }],
              },
              dependencies: [],
              provenance: [{ kind: 'human-patch' as const, ref: 'sidecar:source' }],
            },
          ],
          dependencies: [],
          provenance: [{ kind: 'human-patch' as const, ref: 'sidecar:source' }],
        },
      },
      dependencies: [
        {
          kind: 'catalog' as const,
          subject: PRESENTATION_SURFACE_CATALOG.id,
          version: PRESENTATION_SURFACE_CATALOG.version,
        },
      ],
      provenance: { model: 'human-promotion', generatedAt: 'human-approved-candidate' },
    };
    await appendEvent(getDb(), {
      domain: 'presentation',
      kind: 'render-recipe-promoted',
      rel: 'recipe:durable',
      principal: 'local-user',
      channel: 'presentation',
      detail: {
        eventId: 'promotion:event',
        commandId: 'promotion:command',
        candidate,
      },
    });

    const receipt = await getPresentationBroker().present(
      completePresentationRequest(
        { subject: 'post:first-post', intent: 'review', delivery: 'canvas' },
        { requestId: 'recipe:request', principal: 'local-user', sourceMessageIds: [] },
      ),
    );
    expect(receipt).toMatchObject({ status: 'ready', sidecar: { version: 1 } });
    await expect(
      findActiveSidecar(getDb(), {
        principal: 'local-user',
        subject: 'post:first-post',
        intent: 'review',
        deviceClass: 'any',
      }),
    ).resolves.toMatchObject({
      versions: {
        1: {
          provenance: { kind: 'application-recipe' },
          surface: {
            root: {
              children: [{ child: { bindings: { value: { subject: 'post:first-post' } } } }],
            },
          },
        },
      },
    });
    const stored = await findActiveSidecar(getDb(), {
      principal: 'local-user',
      subject: 'post:first-post',
      intent: 'review',
      deviceClass: 'any',
    });
    expect(JSON.stringify(stored?.versions[1]?.surface)).not.toContain('$slot:');
  });
});
