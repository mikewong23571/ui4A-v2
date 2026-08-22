import {
  runPresentationBroker,
  type PresentationBrokerResolution,
  type PresentationBrokerStore,
} from '@ui4a/engine';
import type { PresentationReceipt, PresentationRequest } from '@ui4a/shared';

export interface AuthorizedRoot {
  rels: string[];
  entities: unknown[];
  policyScope: string;
}

interface WebPresentationBrokerDependencies {
  getEntity(rel: string, principal: string): Promise<unknown | undefined>;
  plan?(
    request: PresentationRequest,
    situation: AuthorizedRoot,
  ): Promise<PresentationBrokerResolution>;
  resolve?(
    request: PresentationRequest,
    situation: AuthorizedRoot,
  ): Promise<PresentationBrokerResolution>;
}

export interface WebPresentationBroker {
  present(request: PresentationRequest): Promise<PresentationReceipt>;
}

function memoryStore(): PresentationBrokerStore {
  const claimed = new Set<string>();
  const receipts = new Map<string, PresentationReceipt>();
  return {
    claim(request) {
      const receipt = receipts.get(request.requestId);
      if (receipt !== undefined) return { kind: 'completed', receipt };
      if (claimed.has(request.requestId)) return { kind: 'in-progress' };
      claimed.add(request.requestId);
      return { kind: 'acquired' };
    },
    complete(receipt) {
      const existing = receipts.get(receipt.requestId);
      if (existing !== undefined) return existing;
      receipts.set(receipt.requestId, receipt);
      return receipt;
    },
  };
}

/**
 * Web I/O adapter for the pure Broker. Phase B deliberately has no Presentation planner or durable
 * Sidecar store yet: a miss fails honestly and recovers to the existing contract renderer.
 */
export function createWebPresentationBroker(
  dependencies: WebPresentationBrokerDependencies,
): WebPresentationBroker {
  const store = memoryStore();
  return {
    present(request) {
      return runPresentationBroker(request, {
        store,
        authorize: async (candidate) => {
          const rels =
            typeof candidate.subject === 'string'
              ? [candidate.subject]
              : candidate.subject.selection;
          const entities = await Promise.all(
            rels.map((rel) => dependencies.getEntity(rel, candidate.principal)),
          );
          if (entities.some((entity) => entity === undefined)) {
            throw new Error('subject unavailable');
          }
          return { rels, entities, policyScope: 'contract' };
        },
        buildSituation: async (_candidate, authorization) => authorization,
        resolve: dependencies.resolve ?? (async () => ({ kind: 'miss' })),
        plan:
          dependencies.plan ??
          (async () => {
            throw new Error('Presentation planner is not configured');
          }),
        recover: async ({ request: candidate }) => ({
          kind: 'fallback',
          surfaceUrl:
            typeof candidate.subject === 'string'
              ? `/canvas?focus=${encodeURIComponent(candidate.subject)}`
              : `/canvas?roots=${encodeURIComponent(candidate.subject.selection.join(','))}`,
        }),
      });
    },
  };
}
