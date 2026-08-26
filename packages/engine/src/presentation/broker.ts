import {
  PRESENTATION_PROTOCOL_VERSION,
  parsePresentationReceipt,
  parsePresentationRequest,
  type PresentationReceipt,
  type PresentationRequest,
  type PresentationSidecarRef,
} from '@ui4a/shared';

type Awaitable<T> = T | Promise<T>;

export type PresentationBrokerStage = 'authorization' | 'situation' | 'resolution' | 'planning';

export type PresentationBrokerResolution =
  | {
      kind: 'ready';
      sidecar?: PresentationSidecarRef;
      surfaceUrl?: string;
      reasonCode?: string;
    }
  | {
      kind: 'fallback';
      surfaceUrl?: string;
      reasonCode?: string;
    }
  | { kind: 'miss' };

export type PresentationBrokerClaim =
  | { kind: 'acquired' }
  | { kind: 'in-progress' }
  | { kind: 'completed'; receipt: PresentationReceipt };

/** Atomic persistence boundary. Implementations own requestId uniqueness and terminal CAS. */
export interface PresentationBrokerStore {
  claim(request: PresentationRequest): Awaitable<PresentationBrokerClaim>;
  complete(receipt: PresentationReceipt): Awaitable<PresentationReceipt>;
}

export interface PresentationBrokerRecoveryContext {
  request: PresentationRequest;
  stage: 'planning';
  error: unknown;
}

export interface PresentationBrokerDependencies<TAuthorization = unknown, TSituation = unknown> {
  store: PresentationBrokerStore;
  /** Must reauthorize roots for this principal; a request itself never grants access. */
  authorize(request: PresentationRequest): Awaitable<TAuthorization>;
  buildSituation(
    request: PresentationRequest,
    authorization: TAuthorization,
  ): Awaitable<TSituation>;
  resolve(
    request: PresentationRequest,
    situation: TSituation,
  ): Awaitable<PresentationBrokerResolution>;
  plan(
    request: PresentationRequest,
    situation: TSituation,
  ): Awaitable<PresentationBrokerResolution>;
  /** Optional mechanical generic fallback. It must not disguise a planner failure as AI success. */
  recover?(
    context: PresentationBrokerRecoveryContext,
  ): Awaitable<Exclude<PresentationBrokerResolution, { kind: 'miss' }> | undefined>;
}

const FAILURE_REASON: Record<PresentationBrokerStage, string> = {
  authorization: 'authorization-failed',
  situation: 'situation-failed',
  resolution: 'resolution-failed',
  planning: 'planning-failed',
};

function pendingReceipt(requestId: string): PresentationReceipt {
  return {
    schemaVersion: PRESENTATION_PROTOCOL_VERSION,
    requestId,
    status: 'pending',
  };
}

function failedReceipt(requestId: string, reasonCode: string): PresentationReceipt {
  return {
    schemaVersion: PRESENTATION_PROTOCOL_VERSION,
    requestId,
    status: 'failed',
    reasonCode,
  };
}

function receiptFromResolution(
  requestId: string,
  resolution: Exclude<PresentationBrokerResolution, { kind: 'miss' }>,
  defaultReasonCode?: string,
): PresentationReceipt {
  return {
    schemaVersion: PRESENTATION_PROTOCOL_VERSION,
    requestId,
    status: resolution.kind,
    ...(resolution.kind === 'ready' && resolution.sidecar !== undefined
      ? { sidecar: resolution.sidecar }
      : {}),
    ...(resolution.surfaceUrl === undefined ? {} : { surfaceUrl: resolution.surfaceUrl }),
    ...(resolution.kind === 'fallback'
      ? { reasonCode: resolution.reasonCode ?? defaultReasonCode ?? 'generic-fallback' }
      : resolution.reasonCode === undefined
        ? {}
        : { reasonCode: resolution.reasonCode }),
  };
}

async function recoverPlanningOrFail(
  request: PresentationRequest,
  error: unknown,
  recover: PresentationBrokerDependencies['recover'],
): Promise<PresentationReceipt> {
  const reasonCode = FAILURE_REASON.planning;
  if (recover !== undefined) {
    try {
      const resolution = await recover({ request, stage: 'planning', error });
      if (resolution !== undefined) {
        return receiptFromResolution(request.requestId, resolution, reasonCode);
      }
    } catch {
      // Recovery is part of Presentation only; its failure must not escape into Chat.
    }
  }
  return failedReceipt(request.requestId, reasonCode);
}

async function commitTerminal(
  store: PresentationBrokerStore,
  receipt: PresentationReceipt,
): Promise<PresentationReceipt> {
  try {
    const committed = parsePresentationReceipt(await store.complete(receipt));
    if (committed.requestId !== receipt.requestId || committed.status === 'pending') {
      return failedReceipt(receipt.requestId, 'receipt-store-invalid');
    }
    return committed;
  } catch {
    return failedReceipt(receipt.requestId, 'receipt-store-failed');
  }
}

/**
 * Pure orchestration foundation for every Presentation origin. All I/O is injected, requestId
 * uniqueness is delegated to an atomic Store, and no Presentation error is allowed to reject.
 */
export async function runPresentationBroker<TAuthorization, TSituation>(
  request: PresentationRequest,
  dependencies: PresentationBrokerDependencies<TAuthorization, TSituation>,
): Promise<PresentationReceipt> {
  try {
    request = parsePresentationRequest(request);
  } catch {
    const requestId =
      typeof (request as Partial<PresentationRequest>).requestId === 'string' &&
      (request as Partial<PresentationRequest>).requestId !== ''
        ? (request as Partial<PresentationRequest>).requestId!
        : 'invalid-presentation-request';
    return failedReceipt(requestId, 'request-invalid');
  }

  let claim: PresentationBrokerClaim;
  try {
    claim = await dependencies.store.claim(request);
  } catch {
    return failedReceipt(request.requestId, 'receipt-store-failed');
  }

  if (claim.kind === 'in-progress') return pendingReceipt(request.requestId);
  if (claim.kind === 'completed') {
    try {
      const existing = parsePresentationReceipt(claim.receipt);
      return existing.requestId === request.requestId && existing.status !== 'pending'
        ? existing
        : failedReceipt(request.requestId, 'receipt-store-invalid');
    } catch {
      return failedReceipt(request.requestId, 'receipt-store-invalid');
    }
  }

  let authorization: TAuthorization;
  try {
    authorization = await dependencies.authorize(request);
  } catch {
    return commitTerminal(
      dependencies.store,
      failedReceipt(request.requestId, FAILURE_REASON.authorization),
    );
  }

  let situation: TSituation;
  try {
    situation = await dependencies.buildSituation(request, authorization);
  } catch {
    return commitTerminal(
      dependencies.store,
      failedReceipt(request.requestId, FAILURE_REASON.situation),
    );
  }

  let resolution: PresentationBrokerResolution;
  try {
    resolution = await dependencies.resolve(request, situation);
  } catch {
    return commitTerminal(
      dependencies.store,
      failedReceipt(request.requestId, FAILURE_REASON.resolution),
    );
  }

  if (resolution.kind === 'miss') {
    try {
      resolution = await dependencies.plan(request, situation);
      if (resolution.kind === 'miss') {
        return commitTerminal(
          dependencies.store,
          await recoverPlanningOrFail(
            request,
            new Error('Presentation planner returned a miss'),
            dependencies.recover,
          ),
        );
      }
    } catch (error) {
      return commitTerminal(
        dependencies.store,
        await recoverPlanningOrFail(request, error, dependencies.recover),
      );
    }
  }

  return commitTerminal(dependencies.store, receiptFromResolution(request.requestId, resolution));
}

export interface PresentationDispatch<TChatOutcome> {
  chatOutcome: TChatOutcome;
  receipt: Promise<PresentationReceipt>;
}

/** Start presentation as a sidecar task while returning the established Chat outcome unchanged. */
export function dispatchPresentation<TChatOutcome, TAuthorization, TSituation>(
  chatOutcome: TChatOutcome,
  request: PresentationRequest,
  dependencies: PresentationBrokerDependencies<TAuthorization, TSituation>,
): PresentationDispatch<TChatOutcome> {
  return {
    chatOutcome,
    receipt: runPresentationBroker(request, dependencies),
  };
}
