import { describe, expect, it, vi } from 'vitest';

import {
  PRESENTATION_PROTOCOL_VERSION,
  type PresentationReceipt,
  type PresentationRequest,
} from '@ui4a/shared';

import {
  dispatchPresentation,
  runPresentationBroker,
  type PresentationBrokerStore,
} from '../index';

const request: PresentationRequest = {
  schemaVersion: PRESENTATION_PROTOCOL_VERSION,
  requestId: 'presentation:req-1',
  principal: 'user:mike',
  subject: 'post:first-post',
  intent: 'inspect article',
  delivery: 'canvas',
  sourceMessageIds: ['message:1'],
};

function memoryStore(): PresentationBrokerStore {
  const receipts = new Map<string, PresentationReceipt>();
  const claimed = new Set<string>();
  return {
    async claim(next) {
      const existing = receipts.get(next.requestId);
      if (existing) return { kind: 'completed', receipt: existing };
      if (claimed.has(next.requestId)) return { kind: 'in-progress' };
      claimed.add(next.requestId);
      return { kind: 'acquired' };
    },
    async complete(receipt) {
      const existing = receipts.get(receipt.requestId);
      if (existing) return existing;
      receipts.set(receipt.requestId, receipt);
      return receipt;
    },
  };
}

describe('runPresentationBroker', () => {
  it('reauthorizes, builds a situation, resolves and commits exactly one terminal receipt', async () => {
    const store = memoryStore();
    const authorize = vi.fn(async () => ({ policyScope: 'own-content' }));
    const buildSituation = vi.fn(async (_request, authorization) => ({
      roots: ['post:first-post'],
      authorization,
    }));
    const resolve = vi.fn(async () => ({
      kind: 'ready' as const,
      sidecar: { id: 'sidecar:1', version: 1 },
      surfaceUrl: '/canvas?sidecar=sidecar%3A1',
    }));
    const plan = vi.fn();

    const deps = { store, authorize, buildSituation, resolve, plan };
    const first = await runPresentationBroker(request, deps);
    const retried = await runPresentationBroker(request, deps);

    expect(first).toEqual(retried);
    expect(first).toMatchObject({
      requestId: request.requestId,
      status: 'ready',
      sidecar: { id: 'sidecar:1', version: 1 },
    });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(buildSituation).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
  });

  it('uses the planner only after a resolver miss', async () => {
    const plan = vi.fn(async () => ({
      kind: 'ready' as const,
      sidecar: { id: 'sidecar:planned', version: 1 },
    }));
    const receipt = await runPresentationBroker(request, {
      store: memoryStore(),
      authorize: async () => ({ policyScope: 'own-content' }),
      buildSituation: async () => ({ roots: ['post:first-post'] }),
      resolve: async () => ({ kind: 'miss' }),
      plan,
    });

    expect(receipt).toMatchObject({ status: 'ready', sidecar: { id: 'sidecar:planned' } });
    expect(plan).toHaveBeenCalledTimes(1);
  });

  it('turns planner rejection into an honest failed receipt without rejecting the chat outcome', async () => {
    const chatOutcome = Object.freeze({ content: 'The article explains the first workflow.' });
    const dispatch = dispatchPresentation(chatOutcome, request, {
      store: memoryStore(),
      authorize: async () => ({ policyScope: 'own-content' }),
      buildSituation: async () => ({ roots: ['post:first-post'] }),
      resolve: async () => ({ kind: 'miss' }),
      plan: async () => {
        throw new Error('model offline');
      },
    });

    expect(dispatch.chatOutcome).toBe(chatOutcome);
    await expect(dispatch.receipt).resolves.toMatchObject({
      requestId: request.requestId,
      status: 'failed',
      reasonCode: 'planning-failed',
    });
    expect(dispatch.chatOutcome).toEqual({ content: 'The article explains the first workflow.' });
  });

  it('can use an explicit mechanical fallback when planning fails', async () => {
    const receipt = await runPresentationBroker(request, {
      store: memoryStore(),
      authorize: async () => ({ policyScope: 'own-content' }),
      buildSituation: async () => ({ roots: ['post:first-post'] }),
      resolve: async () => ({ kind: 'miss' }),
      plan: async () => {
        throw new Error('model offline');
      },
      recover: async ({ stage }) =>
        stage === 'planning'
          ? { kind: 'fallback', surfaceUrl: '/entity?rel=post%3Afirst-post' }
          : undefined,
    });

    expect(receipt).toMatchObject({
      status: 'fallback',
      surfaceUrl: '/entity?rel=post%3Afirst-post',
      reasonCode: 'planning-failed',
    });
  });

  it('returns pending for an in-flight duplicate and cannot create a second terminal receipt', async () => {
    let releasePlan!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releasePlan = resolve;
    });
    const store = memoryStore();
    const deps = {
      store,
      authorize: async () => ({ policyScope: 'own-content' }),
      buildSituation: async () => ({ roots: ['post:first-post'] }),
      resolve: async () => ({ kind: 'miss' as const }),
      plan: async () => {
        await blocked;
        return { kind: 'ready' as const, sidecar: { id: 'sidecar:1', version: 1 } };
      },
    };

    const first = runPresentationBroker(request, deps);
    await Promise.resolve();
    const duplicate = await runPresentationBroker(request, deps);
    expect(duplicate).toEqual({
      schemaVersion: PRESENTATION_PROTOCOL_VERSION,
      requestId: request.requestId,
      status: 'pending',
    });

    releasePlan();
    const terminal = await first;
    expect(terminal.status).toBe('ready');
    await expect(runPresentationBroker(request, deps)).resolves.toEqual(terminal);
  });

  it('fails before situation/resolution when authorization is denied', async () => {
    const buildSituation = vi.fn();
    const resolve = vi.fn();
    const receipt = await runPresentationBroker(request, {
      store: memoryStore(),
      authorize: async () => {
        throw new Error('denied');
      },
      buildSituation,
      resolve,
      plan: vi.fn(),
    });

    expect(receipt).toMatchObject({ status: 'failed', reasonCode: 'authorization-failed' });
    expect(buildSituation).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a malformed thin request before storage or authorization', async () => {
    const store = memoryStore();
    const claim = vi.spyOn(store, 'claim');
    const authorize = vi.fn();
    const receipt = await runPresentationBroker(
      { ...request, sessionId: 'session:must-not-cross-plane' } as PresentationRequest,
      {
        store,
        authorize,
        buildSituation: vi.fn(),
        resolve: vi.fn(),
        plan: vi.fn(),
      },
    );

    expect(receipt).toMatchObject({ status: 'failed', reasonCode: 'request-invalid' });
    expect(claim).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
});
