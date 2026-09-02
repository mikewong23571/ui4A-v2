import { getProductionBrowserAuthentication } from '../../../../auth/production/browser-authentication-runtime';

export async function GET(request: Request): Promise<Response> {
  return getProductionBrowserAuthentication(request).completeCallback(request);
}
