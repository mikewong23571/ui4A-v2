import { getProductionBrowserAuthentication } from '../../../auth/production/browser-authentication-runtime';

export async function POST(request: Request): Promise<Response> {
  return getProductionBrowserAuthentication(request).logout(request);
}
