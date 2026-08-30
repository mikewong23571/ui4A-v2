import { describe, expect, it, vi } from 'vitest';

import { type SirenEntity, type SurfaceBinding, type SurfaceNode } from '@ui4a/engine';
import { completePresentationRequest } from '@ui4a/shared';

import { deriveAppWorkspaceComposition, type AppWorkspaceSitemapView } from './composition';
import { createWebPresentationBroker, type AuthorizedRoot } from '../broker';
import { freezeCompositionDeclaration } from '../compositions';
import { planWorkspaceComposition } from '../runtime-composition';
import { hydratePresentationSurface } from '../../../render/presentation/generic';

const applicationRel = 'application:publishing';
const applicationTitle = '内容发布';
const applicationIntent = '起草、发布并管理内容';
const currentTitle = '内容工作室';
const currentIntent = '从当前定义读取的最新发布能力';

function applicationEntity(title = applicationTitle, intent = applicationIntent): SirenEntity {
  return {
    class: ['application'],
    properties: {
      rel: applicationRel,
      name: 'publishing',
      title,
      intent,
      entry: { target: 'flow:article-drafting', role: 'primary-create' },
      presentation: {
        version: 1,
        traits: ['output-catalog'],
        groupRole: 'definitions',
        priority: 'high',
      },
    },
    actions: [],
    links: [
      { rel: ['self'], href: '/api/entity?rel=application:publishing' },
      { rel: ['entry'], href: '/api/entity?rel=flow:article-drafting' },
    ],
    'guard-results': [],
  };
}

function articleCollection(): SirenEntity {
  return {
    class: ['collection', 'articles'],
    properties: {
      rel: 'articles',
      title: '文章',
      count: 0,
      presentation: {
        version: 1,
        traits: ['output-catalog'],
        groupRole: 'definitions',
        priority: 'normal',
      },
    },
    actions: [],
    links: [{ rel: ['self'], href: '/api/entity?rel=articles' }],
    entities: [],
  };
}

function draftingEntity(): SirenEntity {
  return {
    class: ['flow-instance'],
    properties: {
      rel: 'article-drafting:main',
      node: 'drafting',
      identity: '文章发布向导',
      presentation: {
        version: 1,
        traits: ['work-queue'],
        groupRole: 'definitions',
        priority: 'high',
        fields: [{ path: 'properties.identity', role: 'identity' }],
      },
    },
    actions: [{ name: 'advance', title: '推进', method: 'POST', href: '/api/exec', fields: {} }],
    links: [{ rel: ['self'], href: '/api/entity?rel=article-drafting%3Amain' }],
    'guard-results': [],
  };
}

/** Full real-shape discovery input; the production view is intentionally narrower before G6. */
function landingSitemap(): AppWorkspaceSitemapView {
  return {
    version: 'sitemap-fixture-v1',
    surfaces: [
      { rel: applicationRel, title: applicationTitle, app: 'publishing' },
      {
        rel: 'flow:article-drafting',
        title: '文章发布向导',
        app: 'publishing',
        presentation: {
          version: 1,
          traits: ['work-queue'],
          groupRole: 'definitions',
          priority: 'high',
        },
      },
      {
        rel: 'articles',
        title: '文章',
        collection: true,
        pageable: true,
        app: 'publishing',
        presentation: {
          version: 1,
          traits: ['output-catalog'],
          groupRole: 'definitions',
          priority: 'normal',
        },
      },
      { rel: 'inbox', title: '确认收件箱', collection: true, scope: 'principal' },
      { rel: 'delegations', title: '进行中委托', collection: true, scope: 'principal' },
      { rel: 'threads', title: '工作线', collection: true, scope: 'principal' },
    ],
    applications: [
      {
        rel: applicationRel,
        name: 'publishing',
        title: applicationTitle,
        intent: applicationIntent,
        entry: { target: 'flow:article-drafting', role: 'primary-create' },
        presentation: { version: 1, traits: ['output-catalog'] },
        flows: [
          {
            name: 'article-drafting',
            title: '文章发布向导',
            app: 'publishing',
            initial: 'drafting',
            nodes: [
              {
                name: 'drafting',
                title: '起草',
                fields: [],
                actions: [
                  {
                    name: 'advance',
                    title: '推进',
                    method: 'POST',
                    guards: [],
                    fields: {},
                  },
                ],
              },
            ],
            edges: [],
          },
        ],
      },
    ],
    capabilities: [
      {
        name: 'notify-audience',
        title: '通知受众',
        kind: 'workflow',
        intent: '发送发布通知',
        input: 'notification-request',
        output: 'notification-result',
        scope: { applications: ['publishing'], flows: ['article-drafting'] },
      },
    ],
  } as unknown as AppWorkspaceSitemapView;
}

function walk(node: SurfaceNode, visit: (candidate: SurfaceNode) => void): void {
  visit(node);
  if (node.kind === 'layout') node.children.forEach((child) => walk(child, visit));
  if (node.kind === 'slot') walk(node.child, visit);
  if (node.kind === 'repeat') walk(node.item, visit);
}

function bindingsOf(root: SurfaceNode): SurfaceBinding[] {
  const bindings: SurfaceBinding[] = [];
  walk(root, (node) => {
    if (node.kind === 'word') bindings.push(...Object.values(node.bindings));
    if (node.kind === 'repeat') bindings.push(node.source);
  });
  return bindings;
}

function sourceEntity(source: string): SirenEntity {
  if (source === applicationRel) return applicationEntity();
  if (source === 'articles') return articleCollection();
  if (source === 'flow:article-drafting') return draftingEntity();
  throw new Error(`unexpected landing source: ${source}`);
}

describe('T39 G5 Red: Application landing header is a binding-only contract projection', () => {
  it('binds title/intent/entry/cognition from application:<name> and never becomes a second desk', () => {
    const declaration = deriveAppWorkspaceComposition('publishing', landingSitemap());
    expect(declaration).toBeDefined();
    const sources = declaration!.regions.map(({ source }) => source);

    expect(sources[0]).toBe(applicationRel);
    expect(sources).not.toEqual(expect.arrayContaining(['inbox', 'delegations', 'threads']));

    const regions = declaration!.regions.map((region) => ({
      declaration: region,
      entity: sourceEntity(region.source),
    }));
    const planned = planWorkspaceComposition({
      rels: sources,
      entities: regions.map(({ entity }) => entity),
      declaration,
      regions,
      grantedApplications: ['publishing'],
    });
    const applicationBindings = bindingsOf(planned.surface.root).filter(
      (binding) => binding.kind !== 'item' && binding.subject === applicationRel,
    );
    const propertyPaths = applicationBindings.flatMap((binding) =>
      binding.kind === 'property' ? [binding.path] : [],
    );

    expect(propertyPaths).toEqual(
      expect.arrayContaining([
        'properties.title',
        'properties.intent',
        'properties.entry.target',
        'properties.entry.role',
      ]),
    );
    expect(propertyPaths.some((path) => path.startsWith('properties.presentation'))).toBe(true);

    const contractArtifacts = JSON.stringify({ declaration, surface: planned.surface });
    expect(contractArtifacts).not.toContain(applicationTitle);
    expect(contractArtifacts).not.toContain(applicationIntent);

    const currentApplication = applicationEntity(currentTitle, currentIntent);
    const currentRoots = declaration!.regions.map(({ source }) =>
      source === applicationRel ? currentApplication : sourceEntity(source),
    );
    const hydrated = hydratePresentationSurface(
      'workspace:app:publishing',
      planned.surface,
      currentRoots,
      sources,
    );
    const components = JSON.stringify(hydrated.bundle.messages[2]);
    const data = JSON.stringify(hydrated.bundle.messages[1]);
    expect(hydrated.bundle.issues).toEqual([]);
    expect(components).not.toContain(currentTitle);
    expect(components).not.toContain(currentIntent);
    expect(data).toContain(currentTitle);
    expect(data).toContain(currentIntent);
    expect(data).not.toContain(applicationTitle);
    expect(data).not.toContain(applicationIntent);
  });

  it('uses a stable, complete local membership fingerprint for declaration versioning', () => {
    const baseline = landingSitemap() as unknown as Record<string, unknown>;
    const versionOf = (value: Record<string, unknown>): string =>
      deriveAppWorkspaceComposition('publishing', value as unknown as AppWorkspaceSitemapView)!
        .version;
    const changed = (mutate: (value: Record<string, unknown>) => void): string => {
      const value = structuredClone(baseline);
      mutate(value);
      return versionOf(value);
    };
    const baselineVersion = versionOf(baseline);

    expect(
      changed((value) => {
        const applications = value.applications as Array<Record<string, unknown>>;
        applications[0]!.rel = 'application:publishing-v2';
      }),
    ).not.toBe(baselineVersion);
    expect(
      changed((value) => {
        const applications = value.applications as Array<Record<string, unknown>>;
        applications[0]!.entry = {
          target: 'flow:article-drafting',
          role: 'primary-task',
        };
      }),
    ).not.toBe(baselineVersion);
    expect(
      changed((value) => {
        const applications = value.applications as Array<Record<string, unknown>>;
        const flows = applications[0]!.flows as Array<Record<string, unknown>>;
        flows[0]!.title = '新的文章向导';
      }),
    ).not.toBe(baselineVersion);
    expect(
      changed((value) => {
        const surfaces = value.surfaces as Array<Record<string, unknown>>;
        const articles = surfaces.find(({ rel }) => rel === 'articles')!;
        articles.presentation = {
          version: 1,
          traits: ['review-queue'],
          groupRole: 'responsibility',
          priority: 'high',
        };
      }),
    ).not.toBe(baselineVersion);
    expect(
      changed((value) => {
        const capabilities = value.capabilities as Array<Record<string, unknown>>;
        capabilities[0]!.intent = '新的通知语义';
      }),
    ).not.toBe(baselineVersion);

    const reordered = structuredClone(baseline);
    (reordered.surfaces as unknown[]).reverse();
    const applications = reordered.applications as Array<Record<string, unknown>>;
    (applications[0]!.flows as unknown[]).reverse();
    (reordered.capabilities as unknown[]).reverse();
    expect(versionOf(reordered)).toBe(baselineVersion);
  });
});

function landingRequest(requestId: string) {
  return completePresentationRequest(
    { subject: 'workspace:app:publishing', intent: '了解并进入应用', delivery: 'canvas' },
    { requestId, principal: 'author', sourceMessageIds: [] },
  );
}

function duplicateAliasDeclaration() {
  return freezeCompositionDeclaration({
    id: 'app-publishing',
    version: 'membership-v1',
    regions: [
      {
        region: 'application-header',
        source: applicationRel,
        intent: 'application-capability',
        mode: 'invalidate',
        shape: 'entity',
      },
      {
        region: 'primary-entry',
        source: 'flow:article-drafting',
        intent: 'primary-create',
        mode: 'invalidate',
        shape: 'entity',
      },
      {
        region: 'entry-alias',
        source: 'article-drafting:current',
        intent: 'primary-create',
        mode: 'invalidate',
        shape: 'entity',
      },
    ],
  });
}

describe('T39 G5 Red: authorize aliases first, then deduplicate the visible landing', () => {
  it('renders one canonical entity/action while retaining every authorized source dependency', async () => {
    const declaration = duplicateAliasDeclaration();
    const wizard = draftingEntity();
    let situation: AuthorizedRoot | undefined;
    const getEntity = vi.fn(async (rel: string) => {
      if (rel === applicationRel) return applicationEntity();
      if (rel === 'flow:article-drafting' || rel === 'article-drafting:current') return wizard;
      return undefined;
    });
    const broker = createWebPresentationBroker({
      getEntity,
      resolveCompositionSubject: async () => ({ kind: 'composition', declaration }),
      plan: async (_request, root) => {
        situation = root;
        return { kind: 'ready', surfaceUrl: '/canvas?sidecar=app-publishing' };
      },
    });

    await expect(
      broker.present(landingRequest('g5:dedupe'), { grantedApplications: ['publishing'] }),
    ).resolves.toMatchObject({ status: 'ready' });
    expect(getEntity.mock.calls.map(([rel]) => rel)).toEqual([
      applicationRel,
      'flow:article-drafting',
      'article-drafting:current',
    ]);
    expect(situation).toBeDefined();
    expect(situation!.rels).toEqual([
      applicationRel,
      'flow:article-drafting',
      'article-drafting:current',
    ]);
    expect(situation!.regions?.map(({ entity }) => entity)).toEqual([applicationEntity(), wizard]);
    expect(situation!.declaration?.regions.map(({ source }) => source)).toEqual([
      applicationRel,
      'flow:article-drafting',
    ]);

    const planned = planWorkspaceComposition(situation!);
    const actionBindings = bindingsOf(planned.surface.root).filter(
      (binding) => binding.kind === 'actions' && binding.subject === 'article-drafting:main',
    );
    expect(actionBindings).toHaveLength(1);
    const entityDependencies = planned.dependencies
      .filter(({ kind }) => kind === 'entity-contract')
      .map(({ ref }) => ref);
    expect(entityDependencies).toEqual(
      expect.arrayContaining(['flow:article-drafting', 'article-drafting:current']),
    );
  });

  it('fails the whole Application landing closed when any declared source is unauthorized', async () => {
    const declaration = freezeCompositionDeclaration({
      id: 'app-publishing',
      version: 'membership-v1',
      regions: [
        {
          region: 'application-header',
          source: applicationRel,
          intent: 'application-capability',
          mode: 'invalidate',
          shape: 'entity',
        },
        {
          region: 'private-source',
          source: 'private-review-queue',
          intent: 'review-queue',
          mode: 'invalidate',
          shape: 'collection',
        },
      ],
    });
    const plan = vi.fn(async () => ({ kind: 'ready' as const, surfaceUrl: '/canvas?leaked=1' }));
    const classifyUnauthorized = vi.fn(async (rel: string) =>
      rel === 'private-review-queue' ? ('audience-unreachable' as const) : undefined,
    );
    const broker = createWebPresentationBroker({
      resolveCompositionSubject: async () => ({ kind: 'composition', declaration }),
      getEntity: async (rel) => (rel === applicationRel ? applicationEntity() : undefined),
      classifyUnauthorized,
      plan,
    });

    const receipt = await broker.present(landingRequest('g5:fail-closed'), {
      grantedApplications: ['publishing'],
    });
    expect(receipt).toMatchObject({ status: 'failed', reasonCode: 'audience-unreachable' });
    expect(JSON.stringify(receipt)).not.toContain(applicationTitle);
    expect(JSON.stringify(receipt)).not.toContain('private-review-queue');
    expect(classifyUnauthorized).toHaveBeenCalledWith('private-review-queue', 'author', [
      'publishing',
    ]);
    expect(plan).not.toHaveBeenCalled();
  });
});
