import { describe, expect, it } from 'vitest';

import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';

import { articleDraftingFlow, flowRegistry, seedSnapshot } from '../core/fixtures';
import type { ApplicationDefinition, FlowDefinition } from '../core/types';
import { projectCognitiveSemantics } from './cognitive-semantics';
import { project } from './siren';
import { contentVersion, deriveSitemap } from './sitemap';

const application: ApplicationDefinition = {
  name: 'publishing',
  title: '内容发布',
  intent: '起草、发布并管理内容',
  entry: { target: 'flow:article-drafting', role: 'primary-create' },
};

const systemFallback: ApplicationDefinition = {
  name: 'default',
  title: '默认应用',
  intent: '归一化未声明归属的流程',
  cognitive: { version: 1, traits: ['system-fallback'] },
};

const publishingFlow: FlowDefinition = {
  ...articleDraftingFlow,
  app: 'publishing',
};

const deps = {
  flows: flowRegistry(publishingFlow),
  guards: seedGuardRegistry,
};

function snapshotWith(definition: ApplicationDefinition): EngineSnapshot {
  return {
    ...seedSnapshot,
    applications: { publishing: definition },
  };
}

describe('business Application Siren projection (T39 G3 Red)', () => {
  it('projects the active definition as a stable, read-only business entity', () => {
    const snapshot = snapshotWith(application);
    const before = structuredClone(snapshot);

    const entity = project(snapshot, 'application:publishing', deps);

    expect(entity).toEqual({
      class: ['application'],
      properties: {
        rel: 'application:publishing',
        name: 'publishing',
        title: '内容发布',
        intent: '起草、发布并管理内容',
        entry: { target: 'flow:article-drafting', role: 'primary-create' },
      },
      actions: [],
      links: [
        { rel: ['self'], href: '/api/entity?rel=application:publishing' },
        { rel: ['entry'], href: '/api/entity?rel=flow:article-drafting' },
      ],
      'guard-results': [],
    });
    expect(snapshot).toEqual(before);
  });

  it('does not expose Meta definition payloads or aggregate member and principal work state', () => {
    const entity = project(snapshotWith(application), 'application:publishing', deps);
    expect(entity).toBeDefined();
    const serialized = JSON.stringify(entity) ?? '';

    expect(serialized).not.toContain('meta/application:');
    expect(serialized).not.toContain('/_meta/');
    expect(entity?.properties).not.toHaveProperty('bundle');
    expect(entity?.properties).not.toHaveProperty('status');
    expect(entity?.properties).not.toHaveProperty('version');
    expect(entity?.properties).not.toHaveProperty('members');
    expect(entity?.properties).not.toHaveProperty('threads');
    expect(entity?.properties).not.toHaveProperty('confirmations');
    expect(entity?.properties).not.toHaveProperty('delegations');
    expect(entity?.entities).toBeUndefined();
  });

  it('carries the only Application-level cognitive trait without inventing a landing entry', () => {
    const entity = project(
      { ...seedSnapshot, applications: { default: systemFallback } },
      'application:default',
      deps,
    );

    expect(entity?.properties).toMatchObject({
      rel: 'application:default',
      name: 'default',
      presentation: projectCognitiveSemantics({ declaration: systemFallback.cognitive }),
    });
    expect(entity?.properties).not.toHaveProperty('entry');
    expect(entity?.links.map(({ rel }) => rel)).toEqual([['self']]);
  });

  it('keeps unknown names honestly absent and the neighboring Meta projection unchanged', () => {
    const snapshot = snapshotWith(application);

    expect(project(snapshot, 'application:missing', deps)).toBeUndefined();
    expect(project(snapshot, 'meta/application:publishing', deps)).toMatchObject({
      class: ['meta', 'application-definition'],
      properties: {
        rel: 'meta/application:publishing',
        name: 'publishing',
        status: 'active',
      },
    });
  });

  it('changes the exact contract fingerprint whenever binding content changes', () => {
    const baseline = project(snapshotWith(application), 'application:publishing', deps);
    const changed = project(
      snapshotWith({ ...application, intent: '只管理已发布内容' }),
      'application:publishing',
      deps,
    );

    expect(contentVersion(changed)).not.toBe(contentVersion(baseline));
  });
});

describe('business Application discovery (T39 G3 Red)', () => {
  it('exposes the exact rel and the same title, intent, entry, and cognition to Agent discovery', () => {
    const sitemap = deriveSitemap([publishingFlow], {
      applications: { publishing: application },
    });
    const discovered = sitemap.applications.find(({ name }) => name === 'publishing');

    expect(discovered).toMatchObject({
      rel: 'application:publishing',
      name: 'publishing',
      title: application.title,
      intent: application.intent,
      entry: application.entry,
    });
    expect(sitemap.surfaces).toContainEqual({
      rel: 'application:publishing',
      title: application.title,
      app: 'publishing',
    });
  });

  it('keeps system-fallback cognition discoverable without exposing a normal landing surface', () => {
    const sitemap = deriveSitemap([publishingFlow], {
      applications: { default: systemFallback, publishing: application },
    });
    const fallback = sitemap.applications.find(({ name }) => name === 'default');

    expect(fallback).toMatchObject({
      rel: 'application:default',
      title: systemFallback.title,
      intent: systemFallback.intent,
      presentation: projectCognitiveSemantics({ declaration: systemFallback.cognitive }),
    });
    expect(sitemap.surfaces.map(({ rel }) => rel)).not.toContain('application:default');
  });
});
