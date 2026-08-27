import { parsePresentationRequest } from '@ui4a/shared';

import { getPresentationBroker } from '../../../engine/presentation/runtime';
import { getDb, getEngine } from '../../../engine/service';
import {
  authenticationErrorResponse,
  requestIdentityProfile,
  resolveTrustedRequestIdentity,
} from '../../../auth/request-identity';

export const dynamic = 'force-dynamic';

/** Shared entry for Chat, direct navigation, and Flow transitions. */
export async function POST(request: Request): Promise<Response> {
  let presentationRequest;
  let trustedGrantedApplications: readonly string[] | undefined;
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
      const identity = await resolveTrustedRequestIdentity(request, {
        plane: 'business',
        requiredScopes: ['ui4a:read'],
        authorizedPolicyScopes: Object.keys(snapshot.applications ?? {}),
      });
      presentationRequest = { ...presentationRequest, principal: identity.principal };
      // D51:授予集合随上下文下传 Broker,授权按授予集合 × 事实归属判定。
      trustedGrantedApplications = identity.grantedApplications;
    } catch (error) {
      return (
        authenticationErrorResponse(error) ??
        Response.json({ error: { code: 'credential_malformed' } }, { status: 401 })
      );
    }
  }
  const receipt =
    trustedGrantedApplications === undefined
      ? await getPresentationBroker().present(presentationRequest)
      : await getPresentationBroker().present(presentationRequest, {
          grantedApplications: trustedGrantedApplications,
        });
  return Response.json(receipt);
}
