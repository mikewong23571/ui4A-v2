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
    expect(getEntity).toHaveBeenCalledWith('post:first-post', 'user:local');
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
});
