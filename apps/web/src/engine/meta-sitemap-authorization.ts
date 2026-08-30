import { contentVersion, type Sitemap, type SitemapSurface } from '@ui4a/engine';

import type { MetaSitemap } from './service-sitemaps';

const APPLICATION_PREFIX = 'meta/application:';
const FLOW_PREFIX = 'meta/flow:';
const CAPABILITY_PREFIX = 'meta/capability:';

function suffix(rel: string, prefix: string): string | undefined {
  if (!rel.startsWith(prefix)) return undefined;
  const value = rel.slice(prefix.length);
  return value.length === 0 ? undefined : value;
}

/**
 * Credential Meta discovery follows the same ownership facts as the business sitemap.
 * Collection catalogs remain global discovery roots; unknown exact surfaces fail closed.
 */
export function filterMetaSitemapForGrantedApplications(
  meta: MetaSitemap,
  business: Pick<Sitemap, 'applications' | 'flows' | 'capabilities'>,
  grantedApplications: readonly string[],
): MetaSitemap {
  const granted = new Set(grantedApplications);
  const applications = new Map(
    business.applications.map((application) => [application.name, application]),
  );
  const flows = new Map(business.flows.map((flow) => [flow.name, flow]));
  const capabilities = new Map(
    business.capabilities.map((capability) => [capability.name, capability]),
  );

  const visible = (surface: SitemapSurface): boolean => {
    const application = suffix(surface.rel, APPLICATION_PREFIX);
    if (application !== undefined) {
      return applications.has(application) && granted.has(application);
    }
    const flow = suffix(surface.rel, FLOW_PREFIX);
    if (flow !== undefined) {
      const owner = flows.get(flow)?.app;
      return owner !== undefined && granted.has(owner);
    }
    const capability = suffix(surface.rel, CAPABILITY_PREFIX);
    if (capability !== undefined) {
      return (
        capabilities
          .get(capability)
          ?.scope.applications.some((application) => granted.has(application)) === true
      );
    }
    return surface.rel === 'meta/self' || surface.collection === true;
  };

  const surfaces = meta.surfaces.filter(visible);
  return { ...meta, version: contentVersion(surfaces), surfaces };
}
