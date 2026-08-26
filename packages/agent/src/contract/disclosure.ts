import type { SitemapApplicationSummary, SitemapCapabilitySummary, SitemapSummary } from '../types';

export interface SitemapDisclosureScope {
  scope?: string;
  currentRel?: string;
}

function copyApplication(application: SitemapApplicationSummary): SitemapApplicationSummary {
  return {
    ...application,
    flows: application.flows.map((flow) => ({
      ...flow,
      ...(flow.actions === undefined
        ? {}
        : { actions: flow.actions.map((action) => ({ ...action, guards: [...action.guards] })) }),
    })),
  };
}

function withoutSchemas(capability: SitemapCapabilitySummary): SitemapCapabilitySummary {
  return {
    name: capability.name,
    title: capability.title,
    kind: capability.kind,
    intent: capability.intent,
    ...(capability.input === undefined ? {} : { input: capability.input }),
    ...(capability.output === undefined ? {} : { output: capability.output }),
    scope: {
      applications: [...capability.scope.applications],
      flows: [...capability.scope.flows],
    },
  };
}

function exactSurfaceScope(
  sitemap: SitemapSummary,
  currentRel: string | undefined,
): string | undefined {
  if (currentRel === undefined) return undefined;
  return sitemap.surfaces.find((surface) => surface.rel === currentRel)?.app;
}

/**
 * Produce the bounded sitemap view used by an embedded Agent prompt.
 *
 * Scope is a structured application name. When absent, only an exact current
 * surface rel may supply it; otherwise discovery remains broad. Capability
 * schemas are never part of this prompt-facing view.
 */
export function sliceSitemapDisclosure(
  sitemap: SitemapSummary,
  disclosure: SitemapDisclosureScope,
): SitemapSummary {
  const scope = disclosure.scope ?? exactSurfaceScope(sitemap, disclosure.currentRel);
  const applications =
    scope === undefined
      ? sitemap.applications.map(copyApplication)
      : sitemap.applications
          .filter((application) => application.name === scope)
          .map(copyApplication);
  const applicationFlows = new Set(
    applications.flatMap((application) => application.flows.map((flow) => flow.name)),
  );

  return {
    version: sitemap.version,
    surfaces: sitemap.surfaces.map((surface) =>
      scope === undefined || surface.app === undefined || surface.app === scope
        ? { ...surface }
        : { rel: surface.rel, title: surface.title },
    ),
    applications,
    capabilities: (sitemap.capabilities ?? [])
      .filter(
        (capability) =>
          scope === undefined ||
          (capability.scope.applications.includes(scope) &&
            capability.scope.flows.some((flow) => applicationFlows.has(flow))),
      )
      .map(withoutSchemas),
  };
}
