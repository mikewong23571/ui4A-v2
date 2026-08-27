import { describe, expect, it, vi } from 'vitest';

import { completePresentationRequest, type PresentationRequest } from '@ui4a/shared';

import { createWebPresentationBroker } from './broker';

const request: PresentationRequest = completePresentationRequest(
  { subject: 'post:first-post', intent: 'read article', delivery: 'canvas' },
  {
    requestId: 'turn:1:presentation:1',
    principal: 'user:local',
    sourceMessageIds: ['turn:1'],
  },
);

describe('web Presentation Broker adapter', () => {
  it('reauthorizes the subject and returns an honest generic fallback when planning is unavailable', async () => {
    const getEntity = vi.fn(async () => ({ properties: { rel: 'post:first-post' } }));
    const broker = createWebPresentationBroker({ getEntity });

    const receipt = await broker.present(request);

    expect(receipt).toEqual({
      schemaVersion: 1,
      requestId: request.requestId,
      status: 'fallback',
      surfaceUrl: '/canvas?focus=post%3Afirst-post',
      reasonCode: 'planning-failed',
    });
    expect(getEntity).toHaveBeenCalledWith(
      'post:first-post',
      'user:local',
      'local-demo',
      undefined,
    );
  });

  it('deduplicates requestId across chat, direct navigation, and flow callers', async () => {
    const getEntity = vi.fn(async () => ({ properties: { rel: 'post:first-post' } }));
    const broker = createWebPresentationBroker({ getEntity });

    const chat = await broker.present(request);
    const direct = await broker.present(request);
    const flow = await broker.present(request);

    expect(direct).toEqual(chat);
    expect(flow).toEqual(chat);
    expect(getEntity).toHaveBeenCalledTimes(1);
  });

  it('isolates the same public requestId by trusted policy scope', async () => {
    const getEntity = vi.fn(async (_rel: string, _principal: string, policyScope: string) =>
      policyScope === 'publishing' ? { scope: policyScope } : undefined,
    );
    const broker = createWebPresentationBroker({
      getEntity,
      resolve: async (_candidate, situation) => ({
        kind: 'ready',
        surfaceUrl: `/canvas?scope=${situation.policyScope}`,
      }),
    });

    const publishing = await broker.present(request, { policyScope: 'publishing' });
    const development = await broker.present(request, { policyScope: 'development' });
    const repeated = await broker.present(request, { policyScope: 'publishing' });

    expect(publishing).toMatchObject({ status: 'ready', surfaceUrl: '/canvas?scope=publishing' });
    expect(development).toMatchObject({ status: 'failed', reasonCode: 'authorization-failed' });
    expect(repeated).toEqual(publishing);
    expect(getEntity).toHaveBeenCalledTimes(2);
    expect(publishing.requestId).toBe(request.requestId);
    expect(development.requestId).toBe(request.requestId);
  });

  it('fails closed before planning when the subject is not authorized', async () => {
    const plan = vi.fn();
    const broker = createWebPresentationBroker({ getEntity: async () => undefined, plan });

    await expect(broker.present(request)).resolves.toMatchObject({
      status: 'failed',
      reasonCode: 'authorization-failed',
    });
    expect(plan).not.toHaveBeenCalled();
  });

  it('reauthorizes every explicit selection root and returns one Canvas selection URL', async () => {
    const getEntity = vi.fn(async (rel: string) => ({ properties: { rel } }));
    const broker = createWebPresentationBroker({ getEntity });
    const selection = completePresentationRequest(
      { subject: { selection: ['post:a', 'post:b'] }, intent: 'compare', delivery: 'canvas' },
      { requestId: 'selection:1', principal: 'user:local', sourceMessageIds: [] },
    );

    await expect(broker.present(selection)).resolves.toMatchObject({
      status: 'fallback',
      surfaceUrl: '/canvas?roots=post%3Aa%2Cpost%3Ab',
    });
    expect(getEntity).toHaveBeenCalledTimes(2);
  });

  it('reauthorizes workspace regions in declaration order and keeps unavailable slots', async () => {
    const getEntity = vi.fn(async (rel: string) =>
      rel === 'delegations' ? undefined : { properties: { rel } },
    );
    const resolve = vi.fn(async (_candidate, situation) => {
      expect(
        situation.regions?.map((region: { declaration: { region: string }; entity?: unknown }) => [
          region.declaration.region,
          region.entity,
        ]),
      ).toEqual([
        ['waiting-for-me', { properties: { rel: 'inbox' } }],
        ['in-motion', undefined],
        ['work-lines', { properties: { rel: 'threads' } }],
      ]);
      return { kind: 'ready' as const, reasonCode: 'partial-authorization' };
    });
    const broker = createWebPresentationBroker({ getEntity, resolve });
    const workspace = completePresentationRequest(
      { subject: 'workspace:my-work', intent: 'work', delivery: 'canvas' },
      { requestId: 'workspace:1', principal: 'user:local', sourceMessageIds: [] },
    );

    await expect(broker.present(workspace, { policyScope: 'publishing' })).resolves.toMatchObject({
      status: 'ready',
      reasonCode: 'partial-authorization',
    });
    expect(getEntity.mock.calls.map(([rel]) => rel)).toEqual(['inbox', 'delegations', 'threads']);
    expect(getEntity).toHaveBeenCalledWith('threads', 'user:local', 'publishing', undefined);
  });

  it('threads the trusted granted policy scopes into entity authorization', async () => {
    const getEntity = vi.fn(async () => ({ properties: { rel: 'post:first-post' } }));
    const broker = createWebPresentationBroker({ getEntity });

    await broker.present(request, {
      policyScope: 'default',
      grantedPolicyScopes: ['default', 'publishing'],
    });

    expect(getEntity).toHaveBeenCalledWith('post:first-post', 'user:local', 'default', [
      'default',
      'publishing',
    ]);
  });

  it.each(['workspace:unknown', 'workspace:'])(
    'fails unknown workspace %s closed',
    async (subject) => {
      const getEntity = vi.fn();
      const broker = createWebPresentationBroker({ getEntity });
      const workspace = completePresentationRequest(
        { subject, intent: 'work', delivery: 'canvas' },
        { requestId: `request:${subject}`, principal: 'user:local', sourceMessageIds: [] },
      );

      await expect(broker.present(workspace)).resolves.toMatchObject({
        status: 'failed',
        reasonCode: 'authorization-failed',
      });
      expect(getEntity).not.toHaveBeenCalled();
    },
  );

  it('fails an all-denied workspace before resolution or planning', async () => {
    const resolve = vi.fn();
    const plan = vi.fn();
    const broker = createWebPresentationBroker({
      getEntity: async () => undefined,
      resolve,
      plan,
    });
    const workspace = completePresentationRequest(
      { subject: 'workspace:my-work', intent: 'work', delivery: 'canvas' },
      { requestId: 'workspace:denied', principal: 'user:local', sourceMessageIds: [] },
    );

    await expect(broker.present(workspace)).resolves.toMatchObject({
      status: 'failed',
      reasonCode: 'authorization-failed',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
  });

  it('reauthorizes every region again for each new workspace request', async () => {
    const getEntity = vi.fn(async (rel: string) => ({ properties: { rel } }));
    const broker = createWebPresentationBroker({
      getEntity,
      resolve: async () => ({ kind: 'ready' }),
    });
    const workspace = (requestId: string) =>
      completePresentationRequest(
        { subject: 'workspace:my-work', intent: 'work', delivery: 'canvas' },
        { requestId, principal: 'user:local', sourceMessageIds: [] },
      );

    await broker.present(workspace('workspace:fresh:1'));
    await broker.present(workspace('workspace:fresh:2'));
    expect(getEntity).toHaveBeenCalledTimes(6);
  });
});
