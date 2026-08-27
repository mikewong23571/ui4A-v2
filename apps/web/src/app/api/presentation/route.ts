import { parsePresentationRequest } from '@ui4a/shared';

import { relCoveredByPolicyScope } from '../../../auth/application-scope';
import { getPresentationBroker } from '../../../engine/presentation/runtime';
import { getDb, getEngine } from '../../../engine/service';
import { grantedPolicyScopes } from '../../../engine/situation';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';

export const dynamic = 'force-dynamic';

/** Shared entry for Chat, direct navigation, and Flow transitions. */
export async function POST(request: Request): Promise<Response> {
  let presentationRequest;
  let trustedPolicyScope: string | undefined;
  let trustedGrantedPolicyScopes: readonly string[] | undefined;
  try {
    presentationRequest = parsePresentationRequest(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Presentation request invalid' },
      { status: 400 },
    );
  }
  // production profile(T22 验证修复):接入 application credential(Browser Session
  // 或 Bearer,ui4a:read),并以已认证 principal 覆盖客户端自报 principal——
  // durable Sidecar key 以 principal 区分归属,自报值在生产不可信。
  // local profile 行为不变(保留自报 principal)。
  if (requestIdentityProfile() === 'production') {
    try {
      const engine = await getEngine(getDb());
      const snapshot = engine.getSnapshot();
      // 目标 rel 在请求体内(身份解析前已解析):按 rel 归属在已授予 scope 中
      // 选择(与 /api/entity 同口径,消除伪 403,不扩大授权);多 rel selection
      // 主体要求单一 scope 覆盖全部 rel,逐 rel 选择由 Broker 内授权点负责。
      const subjectRels =
        typeof presentationRequest.subject === 'string'
          ? [presentationRequest.subject]
          : presentationRequest.subject.selection;
      const identity = await resolveTrustedRequestIdentity(request, {
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: Object.keys(snapshot.applications ?? {}),
        defaultPolicyScope: 'default',
        scopeCoverage: (policyScope) =>
          subjectRels.every((rel) =>
            relCoveredByPolicyScope(
              { snapshot, sitemap: engine.getSitemap(), plane: 'business' },
              rel,
              policyScope,
            ),
          ),
      });
      presentationRequest = { ...presentationRequest, principal: identity.principal };
      trustedPolicyScope = identity.policyScope;
      trustedGrantedPolicyScopes = [
        ...new Set([...grantedPolicyScopes(identity.scopes), identity.policyScope]),
      ];
    } catch (error) {
      return (
        authenticationErrorResponse(error) ??
        Response.json({ error: { code: 'credential_malformed' } }, { status: 401 })
      );
    }
  }
  const receipt =
    trustedPolicyScope === undefined
      ? await getPresentationBroker().present(presentationRequest)
      : await getPresentationBroker().present(presentationRequest, {
          policyScope: trustedPolicyScope,
          grantedPolicyScopes: trustedGrantedPolicyScopes,
        });
  return Response.json(receipt);
}
