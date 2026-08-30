import type { SirenFieldPresentation } from '@ui4a/engine';

export interface DeclaredMemberOverview {
  presentation: SirenFieldPresentation;
  value?: string;
}

function shallowText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
    )
  ) {
    return value.map(String).join('、');
  }
  return undefined;
}

/** Shared declaration-order overview projection for card and table member words. */
export function declaredMemberOverview(
  presentations: readonly SirenFieldPresentation[],
  fields: Readonly<Record<string, unknown>> | undefined,
): DeclaredMemberOverview[] {
  return presentations.flatMap((presentation) => {
    if (
      presentation.overview !== true ||
      presentation.role === 'identity' ||
      presentation.role === 'status'
    ) {
      return [];
    }
    const name = presentation.path.split('.').at(-1);
    return name === undefined
      ? []
      : [{ presentation, value: shallowText(fields?.[name]) } satisfies DeclaredMemberOverview];
  });
}
