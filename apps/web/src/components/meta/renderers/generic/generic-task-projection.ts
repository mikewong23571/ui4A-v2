import type { SirenAction, SirenEntity } from '@ui4a/engine';

import type {
  DeclaredDisclosureField,
  GenericDisclosureContract,
} from './generic-disclosure-contract';

const TASK_ROLES = new Set(['identity', 'primary-content', 'status']);

export interface GenericTaskProjection {
  identity?: DeclaredDisclosureField;
  primaryContent?: DeclaredDisclosureField;
  status?: DeclaredDisclosureField;
  hasHumanResponsibility: boolean;
  actions: SirenAction[];
  guardReasons: Map<string, string>;
}

function firstRole(
  contract: Extract<GenericDisclosureContract, { kind: 'declared' }>,
  role: string,
): DeclaredDisclosureField | undefined {
  return contract.fields.find((entry) => entry.field.role === role);
}

export function isTaskDisclosureField(entry: DeclaredDisclosureField): boolean {
  return entry.field.role !== undefined && TASK_ROLES.has(entry.field.role);
}

/** Task meaning is selected by declared field roles, never property or entity names. */
export function projectGenericTask(
  entity: SirenEntity,
  contract: Extract<GenericDisclosureContract, { kind: 'declared' }>,
  actions: SirenAction[],
): GenericTaskProjection {
  return {
    identity: firstRole(contract, 'identity'),
    primaryContent: firstRole(contract, 'primary-content'),
    status: firstRole(contract, 'status'),
    hasHumanResponsibility: contract.semantics.traits?.includes('human-responsibility') === true,
    actions,
    guardReasons: new Map(
      (entity['guard-results'] ?? []).flatMap((guard) =>
        guard.reason === undefined ? [] : [[guard.action, guard.reason] as const],
      ),
    ),
  };
}
