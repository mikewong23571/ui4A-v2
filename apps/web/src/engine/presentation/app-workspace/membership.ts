import { contentVersion } from '@ui4a/engine';
import type { ApplicationEntry } from '@ui4a/shared';

export interface AppWorkspaceSurfaceView {
  rel: string;
  title?: string;
  collection?: boolean;
  pageable?: boolean;
  app?: string;
  scope?: 'application' | 'principal';
  presentation?: unknown;
}

export interface AppWorkspaceApplicationView {
  rel?: string;
  name: string;
  title?: string;
  intent?: string;
  entry?: ApplicationEntry;
  presentation?: unknown;
  flows?: readonly AppWorkspaceFlowView[];
}

export interface AppWorkspaceFlowView {
  name: string;
  title?: string;
  app?: string;
  initial?: string;
  nodes?: readonly unknown[];
  edges?: readonly unknown[];
  presentation?: unknown;
}

export interface AppWorkspaceCapabilityView {
  name: string;
  title?: string;
  kind?: string;
  intent?: string;
  input?: string;
  output?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  scope?: { applications?: readonly string[]; flows?: readonly string[] };
  executor?: unknown;
}

export interface AppWorkspaceSitemapView {
  version?: string;
  surfaces?: readonly AppWorkspaceSurfaceView[];
  applications?: readonly AppWorkspaceApplicationView[];
  capabilities?: readonly AppWorkspaceCapabilityView[];
}

export interface AppWorkspaceMembership {
  application: AppWorkspaceApplicationView;
  applicationRel: string;
  applicationSurfaces: AppWorkspaceSurfaceView[];
  entryTarget?: string;
  version: string;
}

interface MembershipFingerprintEntry {
  source: string;
  role: string;
  cognition?: unknown;
  fingerprint: string;
}

function stableEntries(
  entries: readonly MembershipFingerprintEntry[],
): MembershipFingerprintEntry[] {
  return [...entries].sort((left, right) => {
    const source = left.source.localeCompare(right.source);
    if (source !== 0) return source;
    const role = left.role.localeCompare(right.role);
    return role !== 0 ? role : left.fingerprint.localeCompare(right.fingerprint);
  });
}

/**
 * Resolve one Application's complete local definition membership. Its opaque version includes
 * exact Application bindings plus every declared/derived Flow, business surface and applicable
 * capability. Input order never affects the result; any member content change does.
 */
export function resolveAppWorkspaceMembership(
  scope: string,
  sitemap: AppWorkspaceSitemapView,
): AppWorkspaceMembership | undefined {
  const application = (sitemap.applications ?? []).find((entry) => entry.name === scope);
  if (application === undefined) return undefined;
  const applicationRel = application.rel ?? `application:${application.name}`;
  const surfaces = sitemap.surfaces ?? [];
  const applicationSurfaces = surfaces.filter(
    (surface) =>
      surface.rel !== applicationRel && surface.app === scope && surface.scope !== 'principal',
  );
  const entryTarget = application.entry?.target;
  const entrySurface =
    entryTarget === undefined ? undefined : surfaces.find((surface) => surface.rel === entryTarget);
  const fingerprintSurfaces =
    entrySurface === undefined || applicationSurfaces.some(({ rel }) => rel === entrySurface.rel)
      ? applicationSurfaces
      : [...applicationSurfaces, entrySurface];

  const members: MembershipFingerprintEntry[] = [
    {
      source: applicationRel,
      role: 'application-header',
      cognition: application.presentation,
      fingerprint: contentVersion({
        rel: applicationRel,
        name: application.name,
        title: application.title,
        intent: application.intent,
        entry: application.entry,
        presentation: application.presentation,
      }),
    },
    ...fingerprintSurfaces.map((surface) => ({
      source: surface.rel,
      role:
        surface.rel === entryTarget
          ? (application.entry?.role ?? 'primary-task')
          : surface.collection === true
            ? 'collection'
            : 'flow',
      cognition: surface.presentation,
      fingerprint: contentVersion(surface),
    })),
    ...(application.flows ?? []).map((flow) => ({
      source: `flow:${flow.name}`,
      role: flow.name === entryTarget?.replace(/^flow:/u, '') ? 'entry-flow' : 'flow',
      cognition: flow.presentation,
      fingerprint: contentVersion(flow),
    })),
    ...(sitemap.capabilities ?? [])
      .filter((capability) => capability.scope?.applications?.includes(scope) === true)
      .map((capability) => ({
        source: `capability:${capability.name}`,
        role: 'capability',
        fingerprint: contentVersion(capability),
      })),
  ];

  return {
    application,
    applicationRel,
    applicationSurfaces,
    ...(entryTarget === undefined ? {} : { entryTarget }),
    version: contentVersion(stableEntries(members)),
  };
}
