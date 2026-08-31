import { parseCognitiveSemanticsProjection, type SirenEntity } from '@ui4a/engine';

import type { SitemapApplicationSummary, SitemapCapabilitySummary, SitemapSummary } from '../types';

export interface SitemapDisclosureScope {
  scope?: string;
  currentRel?: string;
  observedApplication?: string;
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

/** Resolve observation ownership from declared surfaces/flows, never from words or preferences. */
export function observedApplication(
  sitemap: SitemapSummary | undefined,
  entity: SirenEntity,
): string | undefined {
  if (sitemap === undefined) return undefined;
  const exact = exactSurfaceScope(
    sitemap,
    typeof entity.properties.rel === 'string' ? entity.properties.rel : undefined,
  );
  if (exact !== undefined) return exact;
  const flows = new Set<string>();
  const visit = (candidate: SirenEntity): void => {
    if (typeof candidate.properties.flow === 'string') flows.add(candidate.properties.flow);
    for (const child of candidate.entities ?? []) visit(child);
  };
  visit(entity);
  const owners = sitemap.applications.filter((application) =>
    application.flows.some((flow) => flows.has(flow.name)),
  );
  return owners.length === 1 ? owners[0]!.name : undefined;
}

/**
 * Produce the bounded sitemap view used by an embedded Agent prompt.
 *
 * Every authorized application/capability/surface stays listed for navigation.
 * Observed ownership (or an explicit disclosure request without an observation)
 * adds one application's flow/action and capability I/O details. User selection
 * is not ownership. Capability schemas never enter this prompt-facing view.
 */
export function sliceSitemapDisclosure(
  sitemap: SitemapSummary,
  disclosure: SitemapDisclosureScope,
): SitemapSummary {
  const scope =
    disclosure.observedApplication ??
    exactSurfaceScope(sitemap, disclosure.currentRel) ??
    disclosure.scope;
  const broad = scope === undefined;
  const applications = sitemap.applications.map((application) =>
    application.name === scope ? copyApplication(application) : broadApplication(application),
  );
  const applicationFlows = new Set(
    applications
      .filter((application) => application.name === scope)
      .flatMap((application) => application.flows.map((flow) => flow.name)),
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
          : { rel: surface.rel, title: surface.title, app: surface.app },
    ),
    applications,
    capabilities: (sitemap.capabilities ?? []).map((capability) =>
      !broad &&
      capability.scope.applications.includes(scope) &&
      capability.scope.flows.some((flow) => applicationFlows.has(flow))
        ? withoutSchemas(capability)
        : broadCapability(capability),
    ),
  };
}
