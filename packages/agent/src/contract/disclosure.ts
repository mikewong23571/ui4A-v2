import { parseCognitiveSemanticsProjection } from '@ui4a/engine';

import type { SitemapApplicationSummary, SitemapCapabilitySummary, SitemapSummary } from '../types';

export interface SitemapDisclosureScope {
  scope?: string;
  currentRel?: string;
}

function cognitiveFieldDisclosure(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  return {
    path: source.path,
    title: source.title,
    ...(source.role === undefined ? {} : { role: source.role }),
    ...(source.overview === undefined ? {} : { overview: source.overview }),
    ...(source.contentMediaType === undefined ? {} : { contentMediaType: source.contentMediaType }),
  };
}

function copyApplication(application: SitemapApplicationSummary): SitemapApplicationSummary {
  const presentation = cognitiveDisclosure(application.presentation);
  return {
    ...(application.rel === undefined ? {} : { rel: application.rel }),
    name: application.name,
    ...(application.title === undefined ? {} : { title: application.title }),
    intent: application.intent,
    ...(application.entry === undefined ? {} : { entry: { ...application.entry } }),
    ...(presentation === undefined ? {} : { presentation }),
    flows: application.flows.map((flow) => ({
      ...flow,
      ...(flow.actions === undefined
        ? {}
        : { actions: flow.actions.map((action) => ({ ...action, guards: [...action.guards] })) }),
    })),
  };
}

/**
 * 广域(无 scope)模式的应用条目:导航级披露(F-10,D41 口径「超限即披露层
 * 缺陷」)。路由信号(name/title/intent/entry)保留;flow 只留 name/title——
 * 动作/守卫/边属执行细节,导航进入 scope 后由 scoped 切片与当前实体合同披露。
 */
function broadApplication(application: SitemapApplicationSummary): SitemapApplicationSummary {
  return {
    ...(application.rel === undefined ? {} : { rel: application.rel }),
    name: application.name,
    ...(application.title === undefined ? {} : { title: application.title }),
    intent: application.intent,
    ...(application.entry === undefined ? {} : { entry: { ...application.entry } }),
    flows: application.flows.map((flow) => ({ name: flow.name, title: flow.title })),
  };
}

function cognitiveDisclosure(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const fields = Array.isArray(source.fields)
    ? source.fields.map(cognitiveFieldDisclosure).filter((field) => field !== undefined)
    : source.fields;
  try {
    return parseCognitiveSemanticsProjection({
      version: source.version,
      ...(source.traits === undefined ? {} : { traits: source.traits }),
      ...(source.groupRole === undefined ? {} : { groupRole: source.groupRole }),
      ...(source.priority === undefined ? {} : { priority: source.priority }),
      ...(source.emptyMeaning === undefined ? {} : { emptyMeaning: source.emptyMeaning }),
      ...(source.fields === undefined ? {} : { fields }),
    });
  } catch {
    return undefined;
  }
}

function copySurface(surface: SitemapSummary['surfaces'][number]) {
  const { presentation: sourcePresentation, ...rest } = surface;
  const presentation = cognitiveDisclosure(sourcePresentation);
  return {
    ...rest,
    ...(presentation === undefined ? {} : { presentation }),
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

/** 广域模式的能力条目:name/title/kind/intent/scope 保留,I/O 描述留到 scoped 切片。 */
function broadCapability(capability: SitemapCapabilitySummary): SitemapCapabilitySummary {
  return {
    name: capability.name,
    title: capability.title,
    kind: capability.kind,
    intent: capability.intent,
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
 * surface rel may supply it; otherwise discovery remains broad — but broad is
 * navigation-level (F-10): every application/capability/surface stays listed
 * for routing, while flow actions/guards/edges and capability I/O prose are
 * disclosed only inside a resolved scope. Capability schemas are never part
 * of this prompt-facing view.
 */
export function sliceSitemapDisclosure(
  sitemap: SitemapSummary,
  disclosure: SitemapDisclosureScope,
): SitemapSummary {
  const scope = disclosure.scope ?? exactSurfaceScope(sitemap, disclosure.currentRel);
  const broad = scope === undefined;
  const applications = broad
    ? sitemap.applications.map(broadApplication)
    : sitemap.applications.filter((application) => application.name === scope).map(copyApplication);
  const applicationFlows = new Set(
    applications.flatMap((application) => application.flows.map((flow) => flow.name)),
  );

  return {
    version: sitemap.version,
    surfaces: sitemap.surfaces.map((surface) =>
      broad
        ? {
            rel: surface.rel,
            title: surface.title,
            ...(surface.app === undefined ? {} : { app: surface.app }),
          }
        : surface.app === undefined || surface.app === scope
          ? copySurface(surface)
          : { rel: surface.rel, title: surface.title },
    ),
    applications,
    capabilities: (sitemap.capabilities ?? [])
      .filter(
        (capability) =>
          broad ||
          (capability.scope.applications.includes(scope) &&
            capability.scope.flows.some((flow) => applicationFlows.has(flow))),
      )
      .map((capability) => (broad ? broadCapability(capability) : withoutSchemas(capability))),
  };
}
