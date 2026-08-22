import {
  summarizePresentationCatalog,
  type PresentationAgent,
  type PresentationDefinitionSummary,
} from '@ui4a/agent';
import {
  createRecipeRegistry,
  enumerateApplicationScenarios,
  registerRecipeCandidate,
  type ApplicationBundle,
  type RecipeRegistry,
  type ScenarioDescriptor,
} from '@ui4a/engine';
import type { SurfaceCatalog } from '@ui4a/engine';

export interface RecipeGenerationFailure {
  jobKey: string;
  scenarioKey: string;
  reasonCode: string;
  issues: string[];
}

export interface RecipeScheduleResult {
  scheduled: number;
  completion: Promise<void>;
}

export interface RecipeCoordinator {
  schedule(bundle: ApplicationBundle): RecipeScheduleResult;
  registry(): RecipeRegistry;
  failures(): RecipeGenerationFailure[];
  retryFailures(): void;
}

interface RecipeCoordinatorDependencies {
  agent: PresentationAgent;
  catalog: SurfaceCatalog;
}

function versionInRef(ref: string, fallback: string): string {
  return /@([^#]+)/.exec(ref)?.[1] ?? fallback;
}

function fieldPointers(bundle: ApplicationBundle): string[] {
  const fields = bundle.flows.flatMap((flow) => [
    ...(flow.fields ?? []),
    ...flow.nodes.flatMap((node) => [
      ...(node.fields ?? []),
      ...node.actions.flatMap((action) => action.fields ?? []),
    ]),
  ]);
  return [
    'properties.rel',
    'properties.node',
    'properties.status',
    ...fields.map((field) => `properties.fields.${field.name}`),
  ].filter((value, index, all) => all.indexOf(value) === index);
}

function definitionKind(ref: string): PresentationDefinitionSummary['kind'] {
  if (ref.startsWith('application:')) return 'application';
  if (ref.startsWith('capability:')) return 'capability';
  if (ref.includes('/action/')) return 'action';
  return 'flow';
}

function definitionContext(
  descriptor: ScenarioDescriptor,
  applicationName: string,
  applicationVersion: string,
  bundle: ApplicationBundle,
): PresentationDefinitionSummary[] {
  const applicationRef = `application:${applicationName}@${applicationVersion}`;
  const refs = descriptor.definitionRefs.includes(applicationRef)
    ? descriptor.definitionRefs
    : [applicationRef, ...descriptor.definitionRefs];
  const allowedPointers = fieldPointers(bundle);
  return refs.map((ref) => ({
    kind: definitionKind(ref),
    ref,
    version: versionInRef(ref, applicationVersion),
    allowedPointers,
  }));
}

function jobKey(descriptor: ScenarioDescriptor, catalog: SurfaceCatalog): string {
  return JSON.stringify({ descriptor, catalog: { id: catalog.id, version: catalog.version } });
}

function protocolExample(descriptor: ScenarioDescriptor) {
  return {
    scenarioKind: descriptor.kind,
    surfaceTemplate: {
      schemaVersion: 1,
      root: {
        kind: 'layout',
        id: 'surface-root',
        role: 'primary-content',
        layout: 'stack',
        children: [
          {
            kind: 'word',
            id: 'subject-identity',
            role: 'identity',
            word: 'heading',
            bindings: {
              value: {
                kind: 'property',
                subject: `$slot:${descriptor.slots[0]}`,
                path: 'properties.rel',
              },
            },
          },
        ],
      },
    },
  };
}

/** In-memory Phase D coordinator; Phase G replaces state with the replayable Recipe projection. */
export function createRecipeCoordinator(
  dependencies: RecipeCoordinatorDependencies,
): RecipeCoordinator {
  let registryState = createRecipeRegistry();
  const seen = new Set<string>();
  const generationFailures = new Map<string, RecipeGenerationFailure>();

  return {
    schedule(bundle) {
      const work = bundle.applications.flatMap((application) => {
        const applicationVersion = String(bundle.bundle.version);
        return enumerateApplicationScenarios({
          application: { definition: application, version: applicationVersion },
          flows: bundle.flows.map((definition) => ({
            definition,
            version: definition.version ?? bundle.bundle.version,
          })),
          capabilities: bundle.capabilities.map((definition) => ({
            definition,
            version: bundle.bundle.version,
          })),
        }).flatMap((descriptor) => {
          const key = jobKey(descriptor, dependencies.catalog);
          if (seen.has(key)) return [];
          seen.add(key);
          return [{ application, applicationVersion, descriptor, key }];
        });
      });

      let cursor = 0;
      const runWorker = async (): Promise<void> => {
        while (cursor < work.length) {
          const { application, applicationVersion, descriptor, key } = work[cursor++]!;
          await Promise.resolve().then(async () => {
            const result = await dependencies.agent.generate({
              scenario: descriptor,
              definitions: definitionContext(
                descriptor,
                application.name,
                applicationVersion,
                bundle,
              ),
              catalog: summarizePresentationCatalog(dependencies.catalog),
              examples: [protocolExample(descriptor)],
            });
            if (result.status === 'failed') {
              generationFailures.set(key, {
                jobKey: key,
                scenarioKey: descriptor.key,
                reasonCode: result.reasonCode,
                issues: result.issues,
              });
              return;
            }
            try {
              const registered = registerRecipeCandidate(
                registryState,
                result.candidate,
                dependencies.catalog,
                key,
              );
              registryState = registered.registry;
              generationFailures.delete(key);
            } catch (error) {
              generationFailures.set(key, {
                jobKey: key,
                scenarioKey: descriptor.key,
                reasonCode: 'candidate-invalid',
                issues: [error instanceof Error ? error.message : String(error)],
              });
            }
          });
        }
      };
      const concurrency = Math.min(2, work.length);
      const completion = Promise.all(Array.from({ length: concurrency }, () => runWorker())).then(
        () => undefined,
      );
      return { scheduled: work.length, completion };
    },
    registry: () => registryState,
    failures: () => [...generationFailures.values()],
    retryFailures() {
      for (const key of generationFailures.keys()) seen.delete(key);
      generationFailures.clear();
    },
  };
}
