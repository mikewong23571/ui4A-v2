import type { ApplicationRecipeSlotBinding } from '@ui4a/engine';

import type { AuthorizedRoot } from './broker';

export interface SingleSubjectRecipeContext {
  subjectShape: string;
  slots: readonly ApplicationRecipeSlotBinding[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Derive one D45 region from the authorized Siren contract; selections fail closed. */
export function singleSubjectRecipeContext(
  root: AuthorizedRoot,
): SingleSubjectRecipeContext | undefined {
  if (root.rels.length !== 1 || root.entities.length !== 1) return undefined;
  const subject = root.rels[0];
  const entity = record(root.entities[0]);
  const classes = entity?.class;
  const properties = record(entity?.properties);
  if (
    subject === undefined ||
    subject.trim() === '' ||
    !Array.isArray(classes) ||
    !classes.every((value) => typeof value === 'string') ||
    properties === undefined
  ) {
    return undefined;
  }

  let subjectShape = 'entity';
  let kind: ApplicationRecipeSlotBinding['kind'] = 'entity';
  const classifier = classes[0];
  const qualifier = classes[1];
  if (classifier === 'flow-instance' && typeof qualifier === 'string' && qualifier !== '') {
    subjectShape = `flow-instance:${qualifier}`;
    kind = 'flow';
  } else if (classifier === 'collection') {
    subjectShape = `collection:${subject}`;
    kind = 'collection';
  } else if (classifier === 'confirmation' && qualifier === 'pending') {
    subjectShape = 'confirmation:pending';
  } else if (
    classifier === 'capability-artifact' &&
    typeof qualifier === 'string' &&
    qualifier !== ''
  ) {
    subjectShape = `capability-artifact:${qualifier}`;
  }
  return { subjectShape, slots: [{ name: 'subject', kind, subject }] };
}
