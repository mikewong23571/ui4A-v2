import { runWebProductionDeploymentPreflight } from '../../production-deployment-preflight';
import type { BrowserAuthentication } from '../browser-session';
import { createInMemoryAuthPrivateStore } from '../in-memory-auth-private-store';
import { createProductionBrowserAuthentication } from '../production-browser-authentication';

import { resolveTrustedRequestOrigin } from './request-origin';

const authentications = new Map<string, BrowserAuthentication>();
const privateStore = createInMemoryAuthPrivateStore();
let productionConfig: ReturnType<typeof runWebProductionDeploymentPreflight>;

/** Lazily compose one process singleton per explicitly trusted browser origin. */
export function getProductionBrowserAuthentication(request?: Request): BrowserAuthentication {
  const config = productionConfig ?? runWebProductionDeploymentPreflight();
  if (config === undefined) {
    throw new Error('production browser authentication requires the production deployment profile');
  }
  productionConfig = config;
  const browserOrigin =
    request === undefined
      ? config.settings.service.publicOrigin
      : resolveTrustedRequestOrigin(request, config.settings.service.trustedRequestOrigins);
  if (browserOrigin === undefined) throw new Error('production browser origin is not trusted');
  const existing = authentications.get(browserOrigin);
  if (existing !== undefined) return existing;
  const authentication = createProductionBrowserAuthentication({
    config,
    browserOrigin,
    clock: Date.now,
    store: privateStore,
  });
  authentications.set(browserOrigin, authentication);
  return authentication;
}
