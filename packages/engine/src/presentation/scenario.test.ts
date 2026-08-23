import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import walkthroughArtifact from '../../../../apps/web/src/applications/ui4a-walkthrough.bundle.json';

import type { ApplicationDefinition, CapabilityDefinition, FlowDefinition } from '@ui4a/shared';

import { parseApplicationBundle } from '../meta-bootstrap';
import {
  SCENARIO_ENUMERATOR_VERSION,
  enumerateApplicationScenarios,
  type ScenarioDescriptor,
  type VersionedScenarioDefinition,
} from './scenario';

function versioned<T>(definition: T, version: string | number = 1): VersionedScenarioDefinition<T> {
  return { definition, version };
}

function ownKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(ownKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...ownKeys(child),
  ]);
}

function descriptorsForPublishing(): ScenarioDescriptor[] {
  const bundle = parseApplicationBundle(walkthroughArtifact);
  const application = bundle.applications.find(({ name }) => name === 'publishing')!;
  return enumerateApplicationScenarios({
    application: versioned(application, bundle.bundle.version),
    flows: bundle.flows
      .filter(({ app }) => app === application.name)
      .map((flow) => versioned(flow, flow.version ?? bundle.bundle.version)),
    capabilities: bundle.capabilities.map((capability) =>
      versioned(capability, bundle.bundle.version),
    ),
  });
}

describe('enumerateApplicationScenarios', () => {
  it('mechanically produces the stable 13-scenario publishing inventory', () => {
    const first = descriptorsForPublishing();
    const second = descriptorsForPublishing();

    expect(second).toEqual(first);
    expect(first).toHaveLength(13);
    expect(new Set(first.map(({ key }) => key)).size).toBe(first.length);
    expect(first.map(({ kind }) => kind)).toEqual([
      'application-overview',
      'entity-inspect',
      'entity-inspect',
      'current-task',
      'current-task',
      'current-task',
      'current-task',
      'current-task',
      'current-task',
      'current-task',
      'current-task',
      'collection-browse',
      'confirmation-review',
    ]);
    expect(first[0]).toEqual({
      key: 'publishing@2/application-overview',
      kind: 'application-overview',
      subjectShape: 'application:publishing',
      intent: 'overview',
      definitionRefs: ['application:publishing@2', 'flow:article-drafting@2', 'flow:post-status@2'],
      slots: ['subject.rel'],
      versions: { enumerator: SCENARIO_ENUMERATOR_VERSION, application: '2' },
    });
    expect(first).toContainEqual({
      key: 'publishing@2/article-drafting@2/current-task/ready',
      kind: 'current-task',
      subjectShape: 'flow-instance:article-drafting',
      intent: 'continue-current-task',
      definitionRefs: ['flow:article-drafting@2#node/ready'],
      slots: ['subject.rel', 'subject.node'],
      versions: {
        enumerator: SCENARIO_ENUMERATOR_VERSION,
        application: '2',
        flow: '2',
      },
    });
    expect(first).toContainEqual({
      key: 'publishing@2/article-drafting@2/collection-browse/articles',
      kind: 'collection-browse',
      subjectShape: 'collection:articles',
      intent: 'browse-members',
      definitionRefs: ['flow:article-drafting@2#node/ready/action/publish/effect/append'],
      slots: ['subject.rel', 'members'],
      versions: {
        enumerator: SCENARIO_ENUMERATOR_VERSION,
        application: '2',
        flow: '2',
      },
    });
    expect(first).toContainEqual({
      key: 'publishing@2/post-status@2/confirmation-review/archive',
      kind: 'confirmation-review',
      subjectShape: 'confirmation:pending',
      intent: 'review-proposed-effect',
      definitionRefs: ['flow:post-status@2#node/published/action/archive'],
      slots: ['subject.rel', 'target.rel', 'target.action'],
      versions: {
        enumerator: SCENARIO_ENUMERATOR_VERSION,
        application: '2',
        flow: '2',
      },
    });
  });

  it('discovers a new definition vocabulary without adding product branches', () => {
    const application: ApplicationDefinition = {
      name: 'orbit',
      title: 'Orbit operations',
      intent: 'Coordinate a newly installed contract.',
    };
    const capability: CapabilityDefinition = {
      name: 'distill',
      title: 'Distill',
      kind: 'transform',
      intent: 'Produce a structured artifact.',
      outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
    };
    const flow: FlowDefinition = {
      name: 'mission-control',
      app: application.name,
      initial: 'queued',
      nodes: [
        {
          name: 'queued',
          actions: [
            {
              name: 'launch',
              title: 'Launch',
              to: 'complete',
              'requires-confirmation': 'high',
              effect: [
                { type: 'transition', to: 'complete' },
                { type: 'append', collection: 'missions' },
                { type: 'spawn', capability: capability.name },
              ],
            },
          ],
        },
        {
          name: 'complete',
          actions: [
            {
              name: 'launch',
              title: 'Launch again',
              'requires-confirmation': 'high',
            },
          ],
        },
        { name: 'unreachable', actions: [] },
      ],
    };

    const descriptors = enumerateApplicationScenarios({
      application: versioned(application, 7),
      flows: [versioned(flow, 3)],
      capabilities: [versioned(capability, 9)],
    });

    expect(descriptors).toHaveLength(7);
    expect(new Set(descriptors.map(({ key }) => key)).size).toBe(descriptors.length);
    expect(descriptors.filter(({ kind }) => kind === 'current-task').map(({ key }) => key)).toEqual(
      [
        'orbit@7/mission-control@3/current-task/queued',
        'orbit@7/mission-control@3/current-task/complete',
      ],
    );
    expect(descriptors.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining([
        'application-overview',
        'entity-inspect',
        'collection-browse',
        'confirmation-review',
        'artifact-inspect',
      ]),
    );
    expect(JSON.stringify(descriptors)).toContain('missions');
    expect(JSON.stringify(descriptors)).toContain('distill');
  });

  it('emits semantic definition templates only, with no runtime identity or UI choice', () => {
    const descriptors = descriptorsForPublishing();
    const allowedKeys = new Set([
      'key',
      'kind',
      'subjectShape',
      'intent',
      'definitionRefs',
      'slots',
      'versions',
      'enumerator',
      'application',
      'flow',
      'capability',
    ]);

    expect(ownKeys(descriptors).filter((key) => !allowedKeys.has(key))).toEqual([]);
    expect(ownKeys(descriptors)).not.toEqual(
      expect.arrayContaining([
        'principal',
        'sessionId',
        'userPreference',
        'component',
        'page',
        'word',
      ]),
    );
    expect(JSON.stringify(descriptors)).not.toMatch(/欢迎来到 UI4A|第一篇|这是第一篇完整文章/);
  });

  it('has no product-name or action-name routing in the enumerator source', () => {
    const source = readFileSync(fileURLToPath(new URL('./scenario.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/publishing|article-drafting|post-status|articles/);
    expect(source).not.toMatch(/unpublish|archive|generate-summary|save-summary/);
    expect(source).not.toMatch(/component|pageName|catalogWord/);
  });
});
