import type { ApplicationDefinition, FlowDefinition, InstanceSnapshot } from '@ui4a/shared';

function appendCollections(flow: FlowDefinition): string[] {
  const collections = new Set<string>();
  for (const node of flow.nodes) {
    for (const action of node.actions) {
      const effects = Array.isArray(action.effect)
        ? action.effect
        : action.effect === undefined
          ? []
          : [action.effect];
      for (const effect of effects) {
        if (effect.type === 'append') collections.add(effect.collection);
      }
    }
  }
  return [...collections];
}

function ownerDescription(owners: ReadonlySet<string>): string {
  return owners.size === 0 ? 'unreachable' : [...owners].join(',');
}

/**
 * Bundle-level entry validation. Membership truth remains Flow.app; seed instances only prove an
 * entity rel's current owning Flow and are never copied into the Application definition.
 */
export function validateApplicationEntryReachability(
  applications: readonly ApplicationDefinition[],
  flows: readonly FlowDefinition[],
  instances: Readonly<Record<string, InstanceSnapshot>> = {},
): void {
  const flowByName = new Map(flows.map((flow) => [flow.name, flow]));
  const collectionOwners = new Map<string, Set<string>>();
  for (const flow of flows) {
    const app = flow.app ?? 'default';
    const collections = new Set([
      ...(flow.collections ?? []).map((declaration) => declaration.collection),
      ...appendCollections(flow),
    ]);
    for (const collection of collections) {
      const owners = collectionOwners.get(collection) ?? new Set<string>();
      owners.add(app);
      collectionOwners.set(collection, owners);
    }
  }

  for (const application of applications) {
    const entry = application.entry;
    if (entry === undefined) continue;
    const target = entry.target;
    if (target.startsWith('flow:')) {
      const flow = flowByName.get(target.slice('flow:'.length));
      const owner = flow?.app ?? (flow === undefined ? undefined : 'default');
      if (owner !== application.name) {
        throw new Error(
          `application entry "${target}" for "${application.name}" is owned by "${owner ?? 'unreachable'}"`,
        );
      }
      continue;
    }
    if (!target.includes(':')) {
      const owners = collectionOwners.get(target) ?? new Set<string>();
      if (owners.size !== 1 || !owners.has(application.name)) {
        throw new Error(
          `application entry "${target}" for "${application.name}" has collection owners "${ownerDescription(owners)}"`,
        );
      }
      continue;
    }
    const instance = instances[target];
    const flow = instance === undefined ? undefined : flowByName.get(instance.flow);
    const owner = flow?.app ?? (flow === undefined ? undefined : 'default');
    if (owner !== application.name) {
      throw new Error(
        `application entry "${target}" for "${application.name}" has entity owner "${owner ?? 'unreachable'}"`,
      );
    }
  }
}
