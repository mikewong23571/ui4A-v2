import type { DraftValidation, FlowDefinition } from '@ui4a/shared';

import { definitionDiff } from '../definition-diff';
import type { DefinitionRegistries } from '../invariants';
import { validateDefinition } from '../invariants';
import { parseFlowDefinition } from '../parse';
import { payloadFingerprint } from './draft';

export interface FlowDraftValidation extends DraftValidation {
  value?: FlowDefinition;
}

/** Parse and validate a Flow candidate with the same registries used by activation. */
export function validateFlowDraft(
  payload: unknown,
  registries: DefinitionRegistries,
): FlowDraftValidation {
  let value: FlowDefinition;
  try {
    value = parseFlowDefinition(payload);
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          code: 'parse-error',
          path: '/',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  const checks = validateDefinition(value, registries);
  const issues = checks.flatMap((check) =>
    check.pass
      ? []
      : (check.detail ?? [check.name]).map((message) => ({
          code: check.name,
          path: '/',
          message,
          evidence: check,
        })),
  );
  return { valid: issues.length === 0, issues, value };
}

/** Full structural diff and deterministic fingerprint; no model or renderer participates. */
export function mechanicalFlowDiff(
  before: unknown,
  after: unknown,
): {
  diff: ReturnType<typeof definitionDiff>;
  hash: string;
} {
  const diff = definitionDiff(parseFlowDefinition(before), parseFlowDefinition(after));
  return { diff, hash: payloadFingerprint(diff) };
}
