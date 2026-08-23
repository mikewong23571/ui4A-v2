import { describe, expect, it, vi } from 'vitest';

import type {
  PresentationAgent,
  PresentationGenerationInput,
  PresentationGenerationResult,
} from '@ui4a/agent';
import { parseApplicationBundle } from '@ui4a/engine';

import walkthroughArtifact from '../../applications/ui4a-walkthrough.bundle.json';
import { PRESENTATION_SURFACE_CATALOG } from './catalog';
import { createRecipeCoordinator } from './recipes';

function publishingBundle() {
  const bundle = parseApplicationBundle(walkthroughArtifact);
  return {
    ...bundle,
    applications: bundle.applications.filter(({ name }) => name === 'publishing'),
    flows: bundle.flows.filter(({ app }) => app === 'publishing'),
  };
}

describe('Application Recipe coordinator', () => {
  it('schedules the 13 publishing scenarios without blocking activation', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const generate = vi.fn(async () => {
      await blocked;
      return {
        status: 'failed' as const,
        reasonCode: 'transport-failed' as const,
        issues: ['probe'],
      };
    });
    const agent: PresentationAgent = { generate };
    const coordinator = createRecipeCoordinator({ agent, catalog: PRESENTATION_SURFACE_CATALOG });
    const scheduled = coordinator.schedule(publishingBundle());

    expect(scheduled.scheduled).toBe(13);
    expect(generate).not.toHaveBeenCalled();
    release();
    await scheduled.completion;
    expect(generate).toHaveBeenCalledTimes(13);
    expect(coordinator.failures()).toHaveLength(13);
  });

  it('deduplicates the same activation inventory and retries failed generation explicitly', async () => {
    const generate = vi.fn(async () => ({
      status: 'failed' as const,
      reasonCode: 'transport-failed' as const,
      issues: ['offline'],
    }));
    const agent: PresentationAgent = { generate };
    const coordinator = createRecipeCoordinator({ agent, catalog: PRESENTATION_SURFACE_CATALOG });
    const bundle = publishingBundle();
    const first = coordinator.schedule(bundle);
    await first.completion;
    const duplicate = coordinator.schedule(bundle);
    expect(duplicate.scheduled).toBe(0);
    coordinator.retryFailures();
    const retried = coordinator.schedule(bundle);
    expect(retried.scheduled).toBe(13);
    await retried.completion;
    expect(generate).toHaveBeenCalledTimes(26);
  });

  it('registers mechanically valid candidates while preserving failures independently', async () => {
    let call = 0;
    const generate = vi.fn(
      async (input: PresentationGenerationInput): Promise<PresentationGenerationResult> => {
        call += 1;
        if (call === 1) {
          return {
            status: 'failed' as const,
            reasonCode: 'output-invalid' as const,
            issues: ['bad candidate'],
          };
        }
        const subject = `$slot:${input.scenario.slots[0]}`;
        return {
          status: 'candidate' as const,
          candidate: {
            key: {
              application: 'publishing',
              applicationVersion: '1',
              scenario: input.scenario.key,
              subjectShape: input.scenario.subjectShape,
              intent: input.scenario.intent,
              catalogVersion: PRESENTATION_SURFACE_CATALOG.version,
            },
            slots: input.scenario.slots.map((name) => ({ name, kind: 'entity' as const })),
            surfaceTemplate: {
              schemaVersion: 1,
              root: {
                kind: 'word',
                id: 'identity',
                role: 'identity',
                word: 'heading',
                bindings: {
                  value: { kind: 'property', subject, path: 'properties.rel' },
                },
                dependencies: [
                  {
                    kind: 'entity',
                    subject,
                    version: '$runtime',
                    paths: ['properties.rel'],
                  },
                  {
                    kind: 'catalog',
                    subject: PRESENTATION_SURFACE_CATALOG.id,
                    version: PRESENTATION_SURFACE_CATALOG.version,
                  },
                ],
                provenance: [
                  { kind: 'presentation-agent', ref: input.scenario.key, model: 'test-model' },
                ],
              },
            },
            dependencies: [
              ...input.scenario.definitionRefs.map((subject) => ({
                kind: 'definition' as const,
                subject,
                version: '1',
              })),
              {
                kind: 'catalog' as const,
                subject: PRESENTATION_SURFACE_CATALOG.id,
                version: PRESENTATION_SURFACE_CATALOG.version,
              },
            ],
            provenance: { model: 'test-model', generatedAt: '2026-08-23T00:00:00.000Z' },
          },
        };
      },
    );
    const agent: PresentationAgent = { generate };
    const coordinator = createRecipeCoordinator({ agent, catalog: PRESENTATION_SURFACE_CATALOG });
    const scheduled = coordinator.schedule(publishingBundle());
    await scheduled.completion;

    expect(coordinator.failures()).toHaveLength(1);
    expect(Object.keys(coordinator.registry().recipes)).toHaveLength(12);
  });
});
