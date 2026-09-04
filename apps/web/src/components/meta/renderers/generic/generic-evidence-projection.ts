import type { GenericDisclosureContract } from './generic-disclosure-contract';
import { isTaskDisclosureField } from './generic-task-projection';

export function projectGenericEvidence(
  contract: Extract<GenericDisclosureContract, { kind: 'declared' }>,
) {
  return contract.fields.filter((entry) => !isTaskDisclosureField(entry));
}
