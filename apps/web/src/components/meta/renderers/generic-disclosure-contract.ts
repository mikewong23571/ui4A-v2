import {
  parseCognitiveSemanticsProjection,
  type CognitiveSemanticsProjectionV1,
  type SirenEntity,
  type SirenFieldPresentation,
} from '@ui4a/engine';

import { valueAtPresentationPath } from './generic-collection-contract';

export interface DeclaredDisclosureField {
  field: SirenFieldPresentation;
  value: unknown;
}

export type GenericDisclosureContract =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | {
      kind: 'declared';
      semantics: CognitiveSemanticsProjectionV1;
      fields: DeclaredDisclosureField[];
    };

/** Strictly adapt the V1 cognitive projection. Malformed declarations expose no inferred facts. */
export function genericDisclosureContract(entity: SirenEntity): GenericDisclosureContract {
  if (entity.properties.presentation === undefined) return { kind: 'absent' };
  try {
    const semantics = parseCognitiveSemanticsProjection(entity.properties.presentation);
    if (semantics?.fields === undefined) return { kind: 'absent' };
    return {
      kind: 'declared',
      semantics,
      fields: semantics.fields.flatMap((field) => {
        const value = valueAtPresentationPath(entity, field.path);
        return value === undefined ? [] : [{ field, value }];
      }),
    };
  } catch {
    return { kind: 'invalid' };
  }
}
