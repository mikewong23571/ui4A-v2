import { getProductionBrowserAuthentication } from '../../../auth/production-browser-authentication';

export async function POST(request: Request): Promise<Response> {
  return getProductionBrowserAuthentication().logout(request);
}
