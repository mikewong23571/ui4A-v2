import { contentVersion, type SirenAction } from '@ui4a/engine';

/** Embedded members influence planning as much as the root, while live values only hydrate. */
function contractShape(entity: unknown): unknown {
  const value = entity as {
    class?: unknown;
    properties?: Record<string, unknown>;
    actions?: SirenAction[];
    links?: unknown;
    entities?: Array<{ properties?: Record<string, unknown> }>;
  };
  return {
    class: value.class,
    presentation: value.properties?.presentation,
    actions: value.actions?.map(actionContract),
    links: value.links,
    members: Array.isArray(value.entities)
      ? value.entities.map((member) => ({
          rel: member.properties?.rel,
          contract: contractShape(member),
        }))
      : undefined,
  };
}

export function entityContractFingerprint(entity: unknown): string {
  return contentVersion(contractShape(entity));
}

/** Selection labels are current projected identities, not action schema or authority. */
function actionContract(action: SirenAction): unknown {
  const annotation = action.fields?.['x-ui4a-reference-selection'] as
    { effect?: unknown; options?: unknown } | undefined;
  if (annotation?.effect !== 'unlink' || !Array.isArray(annotation.options)) return action;
  return {
    ...action,
    fields: {
      ...action.fields,
      'x-ui4a-reference-selection': {
        ...annotation,
        options: annotation.options.map((option: Record<string, unknown>) => ({
          ...option,
          title: undefined,
        })),
      },
    },
  };
}
