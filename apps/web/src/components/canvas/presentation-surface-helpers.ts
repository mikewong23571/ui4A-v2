import type { SirenEntity } from '@ui4a/engine';

import type { RenderSpec } from '@/render/spec';

import type { PresentationDiagnostic } from './canvas-why-drawer';

/** Extract frozen render specs from the ordinary Siren collection contract. */
export function frozenSpecsOf(collection: SirenEntity): RenderSpec[] {
  return (collection.entities ?? []).flatMap((member) => {
    const { concern, component, bind } = member.properties;
    if (typeof concern !== 'string' || typeof component !== 'string' || bind === undefined) {
      return [];
    }
    return [{ concern, component, bind: bind as RenderSpec['bind'] }];
  });
}

export function uniqueDiagnostics(
  entries: readonly PresentationDiagnostic[],
): PresentationDiagnostic[] {
  return [
    ...new Map(
      entries.map((entry) => [
        `${entry.code}:${entry.nodeId}:${entry.path}:${entry.message}:${entry.region ?? ''}`,
        entry,
      ]),
    ).values(),
  ];
}
