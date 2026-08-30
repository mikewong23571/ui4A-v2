import {
  runPresentationBroker,
  type PresentationBrokerResolution,
  type PresentationBrokerStore,
} from '@ui4a/engine';
import {
  PRESENTATION_DENIED_AUDIENCE_UNREACHABLE,
  PRESENTATION_DENIED_SUBJECT_UNAVAILABLE,
  type CompositionRegionDeclaration,
  type PresentationReceipt,
  type PresentationRequest,
} from '@ui4a/shared';

import {
  resolveBuiltinCompositionSubject,
  type BuiltinCompositionDeclaration,
  type BuiltinCompositionSubjectResolution,
} from './compositions';
import { appWorkspaceScopeOf } from './app-workspace-composition';
import { deduplicateApplicationRegions } from './app-workspace/authorization';

export interface PresentationTrustedContext {
  /** 身份解析出的 principal(审计便捷透传);实际判权仍以请求自身的 principal 为准。 */
  principal?: string;
  /**
   * 身份已授予的应用集合(D51):授权按授予集合 × 事实归属判定,不再有会话冻结
   * scope。缺省视为本地信任域(['local-demo'] 标记),该标记跳过受众过滤、仅保留
   * 属主重审。
   */
  grantedApplications?: readonly string[];
}

export interface AuthorizedRegion {
  declaration: Readonly<CompositionRegionDeclaration>;
  entity?: unknown;
  /** Exact canonical entities already represented by a stronger Application region. */
  excludedMemberRels?: readonly string[];
}

/** 授权失败的结构化分类(B1 taxonomy);undefined 表示维持既有 authorization-failed。 */
type UnauthorizedClassification =
  typeof PRESENTATION_DENIED_AUDIENCE_UNREACHABLE | typeof PRESENTATION_DENIED_SUBJECT_UNAVAILABLE;

export interface AuthorizedRoot {
  rels: string[];
  entities: unknown[];
  /** 凭证授予的应用集合(D51 Phase B):policy 依赖指纹的唯一来源。 */
  grantedApplications?: readonly string[];
  declaration?: BuiltinCompositionDeclaration;
  regions?: AuthorizedRegion[];
}

interface WebPresentationBrokerDependencies {
  getEntity(
    rel: string,
    principal: string,
    grantedApplications?: readonly string[],
  ): Promise<unknown | undefined>;
  /**
   * 对 getEntity 返回 undefined 的 rel 做结构化归因(B1):授予外 →
   * audience-unreachable;不存在/不可读 → subject-unavailable。未注入时
   * 维持无 code 的 authorization-failed 通道。
   */
  classifyUnauthorized?(
    rel: string,
    principal: string,
    grantedApplications?: readonly string[],
  ): Promise<UnauthorizedClassification | undefined>;
  /**
   * Composition subject resolution; may be async so runtime can layer derived
   * namespaces (T37 app workspaces) over the static registry.
   */
  resolveCompositionSubject?(
    subject: string,
  ): BuiltinCompositionSubjectResolution | Promise<BuiltinCompositionSubjectResolution>;
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
    present(request, trustedContext: PresentationTrustedContext = {}) {
      // 本地信任域兜底(D51):未传授予集合仅发生在 local profile 路径。
      const grantedApplications = trustedContext.grantedApplications ?? ['local-demo'];
      const namespace = `${request.principal}\0${grantedApplications.join(',')}`;
      let store = stores.get(namespace);
      if (store === undefined) {
        store = memoryStore();
        stores.set(namespace, store);
      }
      // D51/B1:全部所需 rel 都拿不到实体时按分类抛错(首次失败决定 reasonCode;
      // 未注入分类器则保持诚实但无 code 的既有通道)。任一 rel 可见即继续。
      const denialFor = async (
        message: string,
        rels: readonly string[],
        principal: string,
      ): Promise<Error> => {
        if (dependencies.classifyUnauthorized === undefined) return new Error(message);
        const outcomes = await Promise.all(
          rels.map((rel) =>
            dependencies.classifyUnauthorized!(rel, principal, grantedApplications),
          ),
        );
        const code = outcomes.includes(PRESENTATION_DENIED_AUDIENCE_UNREACHABLE)
          ? PRESENTATION_DENIED_AUDIENCE_UNREACHABLE
          : PRESENTATION_DENIED_SUBJECT_UNAVAILABLE;
        return Object.assign(new Error(message), { code });
      };
      return runPresentationBroker(request, {
        store,
        authorize: async (candidate) => {
          const resolveComposition =
            dependencies.resolveCompositionSubject ?? resolveBuiltinCompositionSubject;
          if (typeof candidate.subject === 'string') {
            const composition = await resolveComposition(candidate.subject);
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
                    grantedApplications,
                  ),
                })),
              );
              const visible = regions.filter(
                (region): region is AuthorizedRegion & { entity: unknown } =>
                  region.entity !== undefined,
              );
              const applicationWorkspace = appWorkspaceScopeOf(candidate.subject) !== undefined;
              if (applicationWorkspace && visible.length !== regions.length) {
                throw await denialFor(
                  'workspace unavailable',
                  regions.flatMap((region) =>
                    region.entity === undefined ? [region.declaration.source] : [],
                  ),
                  candidate.principal,
                );
              }
              if (visible.length === 0) {
                throw await denialFor(
                  'workspace unavailable',
                  composition.declaration.regions.map((declaration) => declaration.source),
                  candidate.principal,
                );
              }
              if (applicationWorkspace) {
                const deduplicated = deduplicateApplicationRegions(
                  composition.declaration,
                  visible,
                );
                return {
                  rels: regions.map((region) => region.declaration.source),
                  entities: regions.map((region) => region.entity as unknown),
                  grantedApplications,
                  declaration: deduplicated.declaration,
                  regions: deduplicated.regions,
                };
              }
              return {
                rels: visible.map((region) => region.declaration.source),
                entities: visible.map((region) => region.entity),
                grantedApplications,
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
              dependencies.getEntity(rel, candidate.principal, grantedApplications),
            ),
          );
          if (entities.some((entity) => entity === undefined)) {
            throw await denialFor('subject unavailable', rels, candidate.principal);
          }
          return {
            rels,
            entities,
            grantedApplications,
          };
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
