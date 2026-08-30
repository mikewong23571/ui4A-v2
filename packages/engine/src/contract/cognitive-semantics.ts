import {
  parseCognitiveSemanticsDeclaration,
  type CognitiveSemanticsDeclarationV1,
} from '@ui4a/shared';

import type { SirenFieldPresentation } from './siren/types';

/** The single cognitive source projected into public sitemap and exact Siren contracts. */
export interface CognitiveSemanticsProjectionV1 extends CognitiveSemanticsDeclarationV1 {
  fields?: SirenFieldPresentation[];
}

export interface ProjectCognitiveSemanticsInput {
  declaration?: unknown;
  /** Output of the existing field presentation projector; remains authoritative. */
  fieldPresentations?: readonly SirenFieldPresentation[];
}

/** Merge declared cognition with existing field references without duplicating field authority. */
export function projectCognitiveSemantics(
  input: ProjectCognitiveSemanticsInput,
): CognitiveSemanticsProjectionV1 | undefined {
  const declaration = parseCognitiveSemanticsDeclaration(input.declaration);
  const fields = input.fieldPresentations;
  const hasDeclaredSemantics =
    declaration !== undefined &&
    (declaration.traits !== undefined ||
      declaration.groupRole !== undefined ||
      declaration.priority !== undefined ||
      declaration.emptyMeaning !== undefined);
  const hasFields = fields !== undefined && fields.length > 0;

  if (!hasDeclaredSemantics && !hasFields) return undefined;

  return {
    version: 1,
    ...(declaration?.traits === undefined ? {} : { traits: declaration.traits }),
    ...(declaration?.groupRole === undefined ? {} : { groupRole: declaration.groupRole }),
    ...(declaration?.priority === undefined ? {} : { priority: declaration.priority }),
    ...(declaration?.emptyMeaning === undefined ? {} : { emptyMeaning: declaration.emptyMeaning }),
    ...(hasFields ? { fields: fields.map((field) => ({ ...field })) } : {}),
  };
}
