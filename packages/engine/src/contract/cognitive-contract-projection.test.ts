import { describe, expect, it } from 'vitest';

import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';

import { flowRegistry, postStatusFlow, seedSnapshot } from '../core/fixtures';
import type { ApplicationDefinition, FlowDefinition } from '../core/types';
import { projectCognitiveSemantics } from './cognitive-semantics';
import { project } from './siren';
import { deriveSitemap } from './sitemap';

const fieldPresentations = [
  {
    path: 'properties.fields.title',
    title: '文章标题',
    role: 'identity' as const,
    overview: true,
  },
  {
    path: 'properties.fields.category',
    title: '分类',
    role: 'metadata' as const,
  },
];

const flowCognition = {
  version: 1 as const,
  traits: ['human-responsibility'] as const,
  groupRole: 'responsibility' as const,
  priority: 'high' as const,
  emptyMeaning: 'no-current-responsibility' as const,
};

const applicationCognition = {
  version: 1 as const,
  traits: ['output-catalog'] as const,
  groupRole: 'definition' as const,
  priority: 'normal' as const,
  emptyMeaning: 'ready-to-start' as const,
};

type CognitiveFlow = FlowDefinition;
type CognitiveApplication = ApplicationDefinition;
type PublicPresentation = ReturnType<typeof projectCognitiveSemantics>;

function cognitiveFlow(cognition: FlowDefinition['cognitive'] = flowCognition): CognitiveFlow {
  return {
    ...postStatusFlow,
    app: 'publishing',
    cognitive: cognition,
    fields: [
      {
        name: 'title',
        type: 'text',
        title: '文章标题',
        presentation: { role: 'identity', overview: true },
      },
      {
        name: 'category',
        type: 'text',
        title: '分类',
        presentation: { role: 'metadata' },
      },
    ],
  };
}

function cognitiveApplication(
  cognition: ApplicationDefinition['cognitive'] = applicationCognition,
): CognitiveApplication {
  return {
    name: 'publishing',
    title: '内容发布',
    intent: '起草并发布内容',
    cognitive: cognition,
  };
}

function surfacePresentation(value: unknown): PublicPresentation {
  return (value as { presentation?: PublicPresentation }).presentation;
}

describe('D54 cognitive contract dual projection', () => {
  it('projects one Flow cognitive source identically into discovery and its exact Siren contract', () => {
    const flow = cognitiveFlow();
    const expected = projectCognitiveSemantics({
      declaration: flow.cognitive,
      fieldPresentations,
    });
    const sitemap = deriveSitemap([flow], {
      applications: { publishing: cognitiveApplication() },
    });
    const exact = project(seedSnapshot, 'post:post-welcome', {
      flows: flowRegistry(flow),
      guards: seedGuardRegistry,
    });

    const discovery = surfacePresentation(
      sitemap.surfaces.find(({ rel }) => rel === 'flow:post-status'),
    );
    const exactPresentation = exact?.properties.presentation;

    expect(discovery).toEqual(expected);
    expect(exactPresentation).toEqual(expected);
    expect(discovery).toEqual(exactPresentation);
  });

  it('projects one Application cognitive source identically into discovery and exact Siren', () => {
    const application = cognitiveApplication();
    const sitemap = deriveSitemap([cognitiveFlow()], {
      applications: { publishing: application },
    });
    const exact = project(
      {
        ...seedSnapshot,
        applications: { publishing: application },
      },
      'meta/application:publishing',
      {
        flows: flowRegistry(cognitiveFlow()),
        guards: seedGuardRegistry,
      },
    );
    const expected = projectCognitiveSemantics({ declaration: application.cognitive });

    expect(surfacePresentation(sitemap.applications[0])).toEqual(expected);
    expect(exact?.properties.presentation).toEqual(expected);
    expect(surfacePresentation(sitemap.applications[0])).toEqual(exact?.properties.presentation);
  });

  it('includes Flow and Application cognitive changes in the sitemap content version', () => {
    const baseline = deriveSitemap([cognitiveFlow()], {
      applications: { publishing: cognitiveApplication() },
    });
    const changedFlow = deriveSitemap([cognitiveFlow({ ...flowCognition, priority: 'low' })], {
      applications: { publishing: cognitiveApplication() },
    });
    const changedApplication = deriveSitemap([cognitiveFlow()], {
      applications: {
        publishing: cognitiveApplication({ ...applicationCognition, priority: 'low' }),
      },
    });

    expect(changedFlow.version).not.toBe(baseline.version);
    expect(changedApplication.version).not.toBe(baseline.version);
  });

  it('keeps an entity with no declared or derived cognition honestly absent', () => {
    const blankFlow: FlowDefinition = {
      name: 'blank',
      title: 'Blank',
      initial: 'idle',
      nodes: [{ name: 'idle', actions: [] }],
    };
    const snapshot: EngineSnapshot = {
      instances: {
        'blank:one': {
          rel: 'blank:one',
          flow: 'blank',
          node: 'idle',
          fields: {},
        },
      },
      collections: {},
    };
    const sitemap = deriveSitemap([blankFlow]);
    const exact = project(snapshot, 'blank:one', {
      flows: flowRegistry(blankFlow),
      guards: seedGuardRegistry,
    });

    expect(surfacePresentation(sitemap.surfaces[0])).toBeUndefined();
    expect(exact?.properties).not.toHaveProperty('presentation');
  });
});
