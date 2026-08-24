import { getProductionBrowserAuthentication } from '../../../../auth/production-browser-authentication';

export async function GET(request: Request): Promise<Response> {
  return getProductionBrowserAuthentication().completeCallback(request);
}
