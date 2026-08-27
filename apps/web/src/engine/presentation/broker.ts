import {
  runPresentationBroker,
  type PresentationBrokerResolution,
  type PresentationBrokerStore,
} from '@ui4a/engine';
import type { PresentationReceipt, PresentationRequest } from '@ui4a/shared';
import type { CompositionRegionDeclaration } from '@ui4a/shared';

import {
  resolveBuiltinCompositionSubject,
  type BuiltinCompositionDeclaration,
  type BuiltinCompositionSubjectResolution,
} from './compositions';

export interface PresentationTrustedContext {
  policyScope: string;
}

export interface AuthorizedRegion {
  declaration: Readonly<CompositionRegionDeclaration>;
  entity?: unknown;
}

export interface AuthorizedRoot {
  rels: string[];
  entities: unknown[];
  policyScope: string;
  declaration?: BuiltinCompositionDeclaration;
  regions?: AuthorizedRegion[];
}

interface WebPresentationBrokerDependencies {
  getEntity(rel: string, principal: string, policyScope: string): Promise<unknown | undefined>;
  resolveCompositionSubject?(subject: string): BuiltinCompositionSubjectResolution;
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
  present(
    request: PresentationRequest,
    trustedContext?: PresentationTrustedContext,
  ): Promise<PresentationReceipt>;
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
 * Web I/O adapter for the pure Broker: resolves authorization and entity reads over
 * HTTP-side services and delegates planning/reuse to the pure kernel. T30 起 planner
 * 与持久 Sidecar store(runtime.ts 经 db/presentation 投影)均已接入;adapter 自身
 * 不持有规划或存储语义。
 */
export function createWebPresentationBroker(
  dependencies: WebPresentationBrokerDependencies,
): WebPresentationBroker {
  const stores = new Map<string, PresentationBrokerStore>();
  return {
    present(request, trustedContext = { policyScope: 'local-demo' }) {
      const namespace = `${request.principal}\0${trustedContext.policyScope}`;
      let store = stores.get(namespace);
      if (store === undefined) {
        store = memoryStore();
        stores.set(namespace, store);
      }
      return runPresentationBroker(request, {
        store,
        authorize: async (candidate) => {
          const resolveComposition =
            dependencies.resolveCompositionSubject ?? resolveBuiltinCompositionSubject;
          if (typeof candidate.subject === 'string') {
            const composition = resolveComposition(candidate.subject);
            if (composition.kind === 'rejected-workspace') {
              throw new Error('workspace unavailable');
            }
            if (composition.kind === 'composition') {
              const regions = await Promise.all(
                composition.declaration.regions.map(async (declaration) => ({
                  declaration,
                  entity: await dependencies.getEntity(
                    declaration.source,
                    candidate.principal,
                    trustedContext.policyScope,
                  ),
                })),
              );
              const visible = regions.filter(
                (region): region is AuthorizedRegion & { entity: unknown } =>
                  region.entity !== undefined,
              );
              if (visible.length === 0) throw new Error('workspace unavailable');
              return {
                rels: visible.map((region) => region.declaration.source),
                entities: visible.map((region) => region.entity),
                policyScope: trustedContext.policyScope,
                declaration: composition.declaration,
                regions,
              };
            }
          }
          const rels =
            typeof candidate.subject === 'string'
              ? [candidate.subject]
              : candidate.subject.selection;
          const entities = await Promise.all(
            rels.map((rel) =>
              dependencies.getEntity(rel, candidate.principal, trustedContext.policyScope),
            ),
          );
          if (entities.some((entity) => entity === undefined)) {
            throw new Error('subject unavailable');
          }
          return { rels, entities, policyScope: trustedContext.policyScope };
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
