import { runWebProductionDeploymentPreflight } from '../../../production-deployment-preflight';

export function GET(): Response {
  const config = runWebProductionDeploymentPreflight();
  if (config === undefined) {
    return Response.json({ error: { code: 'account_management_unavailable' } }, { status: 404 });
  }
  return Response.redirect(`${config.settings.auth.oidc.issuer}/account/`, 302);
}
