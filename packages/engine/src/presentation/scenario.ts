import {
  reachableNodes,
  type ApplicationDefinition,
  type CapabilityDefinition,
  type EffectDefinition,
  type FlowDefinition,
} from '@ui4a/shared';

export const SCENARIO_ENUMERATOR_VERSION = 1 as const;

export type ScenarioKind =
  | 'application-overview'
  | 'entity-inspect'
  | 'current-task'
  | 'collection-browse'
  | 'confirmation-review'
  | 'artifact-inspect';

export interface VersionedScenarioDefinition<T> {
  definition: T;
  version: string | number;
}

export interface ScenarioDescriptorVersions {
  enumerator: typeof SCENARIO_ENUMERATOR_VERSION;
  application: string;
  flow?: string;
  capability?: string;
}

/** Definition-only seed for a parameterized Presentation Recipe. */
export interface ScenarioDescriptor {
  key: string;
  kind: ScenarioKind;
  subjectShape: string;
  intent: string;
  definitionRefs: string[];
  slots: string[];
  versions: ScenarioDescriptorVersions;
}

export interface ScenarioEnumeratorInput {
  application: VersionedScenarioDefinition<ApplicationDefinition>;
  flows: readonly VersionedScenarioDefinition<FlowDefinition>[];
  capabilities?: readonly VersionedScenarioDefinition<CapabilityDefinition>[];
}

interface FlowContext {
  definition: FlowDefinition;
  version: string;
  baseKey: string;
  baseRef: string;
  reachable: ReadonlySet<string>;
}

function versionOf(value: string | number): string {
  return String(value);
}

function effectsOf(effect: EffectDefinition | EffectDefinition[] | undefined): EffectDefinition[] {
  if (effect === undefined) return [];
  return Array.isArray(effect) ? effect : [effect];
}

function flowVersions(applicationVersion: string, flowVersion: string) {
  return {
    enumerator: SCENARIO_ENUMERATOR_VERSION,
    application: applicationVersion,
    flow: flowVersion,
  } as const;
}

function actionRef(flow: FlowContext, node: string, action: string): string {
  return `${flow.baseRef}#node/${node}/action/${action}`;
}

function descriptorsForCollections(
  applicationVersion: string,
  flows: readonly FlowContext[],
): ScenarioDescriptor[] {
  const descriptors: ScenarioDescriptor[] = [];
  for (const flow of flows) {
    const byCollection = new Map<string, string[]>();
    for (const node of flow.definition.nodes) {
      if (!flow.reachable.has(node.name)) continue;
      for (const action of node.actions) {
        for (const effect of effectsOf(action.effect)) {
          if (effect.type !== 'append') continue;
          const reference = `${actionRef(flow, node.name, action.name)}/effect/append`;
          const references = byCollection.get(effect.collection) ?? [];
          if (!references.includes(reference)) references.push(reference);
          byCollection.set(effect.collection, references);
        }
      }
    }
    for (const [collection, definitionRefs] of byCollection) {
      descriptors.push({
        key: `${flow.baseKey}/collection-browse/${collection}`,
        kind: 'collection-browse',
        subjectShape: `collection:${collection}`,
        intent: 'browse-members',
        definitionRefs,
        slots: ['subject'],
        versions: flowVersions(applicationVersion, flow.version),
      });
    }
  }
  return descriptors;
}

function descriptorsForConfirmations(
  applicationVersion: string,
  flows: readonly FlowContext[],
): ScenarioDescriptor[] {
  const descriptors: ScenarioDescriptor[] = [];
  for (const flow of flows) {
    const referencesByAction = new Map<string, string[]>();
    for (const node of flow.definition.nodes) {
      if (!flow.reachable.has(node.name)) continue;
      for (const action of node.actions) {
        if (action['requires-confirmation'] !== 'high') continue;
        const references = referencesByAction.get(action.name) ?? [];
        references.push(actionRef(flow, node.name, action.name));
        referencesByAction.set(action.name, references);
      }
    }
    for (const [action, definitionRefs] of referencesByAction) {
      descriptors.push({
        key: `${flow.baseKey}/confirmation-review/${action}`,
        kind: 'confirmation-review',
        subjectShape: 'confirmation:pending',
        intent: 'review-proposed-effect',
        definitionRefs,
        slots: ['subject'],
        versions: flowVersions(applicationVersion, flow.version),
      });
    }
  }
  return descriptors;
}

function descriptorsForArtifacts(
  applicationVersion: string,
  flows: readonly FlowContext[],
  capabilities: readonly VersionedScenarioDefinition<CapabilityDefinition>[],
): ScenarioDescriptor[] {
  const capabilityByName = new Map(capabilities.map((entry) => [entry.definition.name, entry]));
  const descriptors: ScenarioDescriptor[] = [];

  for (const flow of flows) {
    const referencesByCapability = new Map<string, string[]>();
    for (const node of flow.definition.nodes) {
      if (!flow.reachable.has(node.name)) continue;
      for (const action of node.actions) {
        for (const effect of effectsOf(action.effect)) {
          if (effect.type !== 'spawn') continue;
          const capability = capabilityByName.get(effect.capability);
          if (capability?.definition.outputSchema === undefined) continue;
          const reference = actionRef(flow, node.name, action.name);
          const references = referencesByCapability.get(effect.capability) ?? [];
          if (!references.includes(reference)) references.push(reference);
          referencesByCapability.set(effect.capability, references);
        }
      }
    }

    for (const [capabilityName, actionRefs] of referencesByCapability) {
      const capabilityVersion = versionOf(capabilityByName.get(capabilityName)!.version);
      descriptors.push({
        key: `${flow.baseKey}/artifact-inspect/${capabilityName}`,
        kind: 'artifact-inspect',
        subjectShape: `capability-artifact:${capabilityName}`,
        intent: 'inspect-provenance-and-output',
        definitionRefs: [...actionRefs, `capability:${capabilityName}@${capabilityVersion}`],
        slots: ['subject'],
        versions: {
          ...flowVersions(applicationVersion, flow.version),
          capability: capabilityVersion,
        },
      });
    }
  }
  return descriptors;
}

/**
 * Enumerate parameterized situations from active definitions in declaration order.
 * Runtime values and presentation choices belong to later authorization and planning stages.
 */
export function enumerateApplicationScenarios(
  input: ScenarioEnumeratorInput,
): ScenarioDescriptor[] {
  const applicationName = input.application.definition.name;
  const applicationVersion = versionOf(input.application.version);
  const flows: FlowContext[] = input.flows
    .filter(({ definition }) => (definition.app ?? 'default') === applicationName)
    .map(({ definition, version }) => {
      const normalizedVersion = versionOf(version);
      return {
        definition,
        version: normalizedVersion,
        baseKey: `${applicationName}@${applicationVersion}/${definition.name}@${normalizedVersion}`,
        baseRef: `flow:${definition.name}@${normalizedVersion}`,
        reachable: reachableNodes(definition),
      };
    });

  const descriptors: ScenarioDescriptor[] = [
    {
      key: `${applicationName}@${applicationVersion}/application-overview`,
      kind: 'application-overview',
      subjectShape: `application:${applicationName}`,
      intent: 'overview',
      definitionRefs: [
        `application:${applicationName}@${applicationVersion}`,
        ...flows.map(({ baseRef }) => baseRef),
      ],
      slots: ['subject'],
      versions: {
        enumerator: SCENARIO_ENUMERATOR_VERSION,
        application: applicationVersion,
      },
    },
    ...flows.map((flow) => ({
      key: `${flow.baseKey}/entity-inspect`,
      kind: 'entity-inspect' as const,
      subjectShape: `flow-instance:${flow.definition.name}`,
      intent: 'inspect-entity',
      definitionRefs: [flow.baseRef],
      slots: ['subject'],
      versions: flowVersions(applicationVersion, flow.version),
    })),
    ...flows.flatMap((flow) =>
      flow.definition.nodes
        .filter((node) => flow.reachable.has(node.name))
        .map((node) => ({
          key: `${flow.baseKey}/current-task/${node.name}`,
          kind: 'current-task' as const,
          subjectShape: `flow-instance:${flow.definition.name}`,
          intent: 'continue-current-task',
          definitionRefs: [`${flow.baseRef}#node/${node.name}`],
          slots: ['subject'],
          versions: flowVersions(applicationVersion, flow.version),
        })),
    ),
  ];

  descriptors.push(
    ...descriptorsForCollections(applicationVersion, flows),
    ...descriptorsForConfirmations(applicationVersion, flows),
    ...descriptorsForArtifacts(applicationVersion, flows, input.capabilities ?? []),
  );
  return descriptors;
}
