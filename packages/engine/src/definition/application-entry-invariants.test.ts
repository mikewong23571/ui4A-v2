import { describe, expect, it } from 'vitest';

import { DEFINITION_BUNDLE_SCHEMA, parseDefinitionBundle } from './definition-bundle';
import { parseApplicationBundle, planMetaBootstrap } from './meta-bootstrap';

const bundleSchema = 'https://ui4a.dev/application-bundle/v1';

function application(name: string, target: string, role: string): Record<string, unknown> {
  return {
    name,
    title: name === 'publishing' ? '内容发布' : '社区互动',
    intent: name === 'publishing' ? '发布内容' : '审核评论',
    entry: { target, role },
  };
}

function flow(name: string, app: string, collection: string): Record<string, unknown> {
  return {
    name,
    title: name === 'post-status' ? '文章状态' : '评论审核',
    app,
    initial: 'pending',
    fields: [],
    collections: [{ collection }],
    nodes: [{ name: 'pending', fields: [], actions: [] }],
  };
}

function artifact(entryTarget: string, entryRole: string) {
  return {
    schema: bundleSchema,
    bundle: { name: 'entry-invariants', version: 1 },
    applications: [application('publishing', entryTarget, entryRole)],
    capabilities: [],
    flows: [flow('post-status', 'publishing', 'articles')],
    seed: {
      rel: 'seed:entry-invariants',
      detail: {
        instances: {
          'post:first': {
            rel: 'post:first',
            flow: 'post-status',
            node: 'pending',
            fields: {},
          },
        },
        collections: { articles: ['post:first'] },
      },
    },
  };
}

function definitionArtifact(entryTarget: string, entryRole: string) {
  const applicationDefinition = application('publishing', entryTarget, entryRole);
  const flowDefinition = flow('post-status', 'publishing', 'articles');
  return {
    schema: DEFINITION_BUNDLE_SCHEMA,
    bundle: { name: 'entry-invariants', version: 1 },
    applications: [applicationDefinition],
    capabilities: [],
    flows: [flowDefinition],
    policies: [],
    provenance: {
      source: 'active-definition-log',
      application: 'publishing',
      flows: [{ name: 'post-status', version: 1 }],
    },
  };
}

describe('Application entry activation and bundle invariants (T39 G1 Red)', () => {
  it.each([
    ['flow:post-status', 'primary-task'],
    ['articles', 'primary-collection'],
    ['post:first', 'resume'],
  ])('accepts reachable same-Application business target %s', (target, role) => {
    const parsed = parseApplicationBundle(artifact(target, role));
    expect(parsed.applications[0]?.entry).toEqual({ target, role });
  });

  it('preserves the structured entry in the activated application definition event', () => {
    const parsed = parseApplicationBundle(artifact('flow:post-status', 'primary-task'));
    const applicationSeed = planMetaBootstrap(parsed, []).find(
      (event) => event.kind === 'application-seeded',
    );
    expect(applicationSeed?.detail).toMatchObject({
      definition: {
        name: 'publishing',
        entry: { target: 'flow:post-status', role: 'primary-task' },
      },
    });
  });

  it('rejects a target owned by another Application with an actionable issue', () => {
    const candidate = artifact('flow:comment-moderation', 'primary-task');
    candidate.applications.push(application('community', 'comments', 'primary-collection'));
    candidate.flows.push(flow('comment-moderation', 'community', 'comments'));

    expect(() => parseApplicationBundle(candidate)).toThrow(
      /entry.*flow:comment-moderation.*publishing.*community/i,
    );
  });

  it.each([
    ['flow:missing', 'primary-task'],
    ['missing-collection', 'primary-collection'],
    ['post:missing', 'resume'],
  ])('rejects unreachable target %s with the Application name in the issue', (target, role) => {
    expect(() => parseApplicationBundle(artifact(target, role))).toThrow(
      new RegExp(`entry.*${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*publishing`, 'i'),
    );
  });

  it('rejects a system fallback that declares a normal landing entry', () => {
    const candidate = artifact('flow:post-status', 'primary-task');
    candidate.applications[0] = {
      ...candidate.applications[0]!,
      cognitive: { version: 1, traits: ['system-fallback'] },
    };
    expect(() => parseApplicationBundle(candidate)).toThrow(/system-fallback.*entry/i);
  });

  it('enforces the same reachable ownership rule when importing an editable Definition Bundle', () => {
    expect(
      parseDefinitionBundle(definitionArtifact('flow:post-status', 'primary-task')).applications[0]
        ?.entry,
    ).toEqual({ target: 'flow:post-status', role: 'primary-task' });

    const candidate = definitionArtifact('flow:comment-moderation', 'primary-task');
    candidate.applications.push(application('community', 'comments', 'primary-collection'));
    candidate.flows.push(flow('comment-moderation', 'community', 'comments'));
    expect(() => parseDefinitionBundle(candidate)).toThrow(
      /entry.*flow:comment-moderation.*publishing.*community/i,
    );
  });
});
