import type { PresenceProjection, RenderSubject } from '@ui4a/shared';

export interface SituationExplicitParameters {
  site?: string;
  scope?: string;
  thread?: string | null;
  focus?: RenderSubject | null;
}

export interface SituationDefaults {
  site: string;
  scope: string;
  thread?: string | null;
  focus?: RenderSubject | null;
}

export interface SituationInput {
  principal: string;
  grantedScopes: readonly string[];
  presence?: PresenceProjection;
  explicit?: SituationExplicitParameters;
  defaults: SituationDefaults;
}

export interface SituationDisclosureSlice {
  scope: string;
  thread: string | null;
  focus: RenderSubject | null;
}

export interface Situation {
  principal: string;
  site: string;
  scope: string;
  thread: string | null;
  focus: RenderSubject | null;
  disclosure: SituationDisclosureSlice;
}

function firstString(...values: Array<string | null | undefined>): string {
  const value = values.find((entry): entry is string => entry !== undefined && entry !== '');
  if (value === undefined) throw new Error('situation requires a non-empty string');
  return value;
}

function scopeFrom(input: SituationInput): string {
  const candidates = [input.explicit?.scope, input.presence?.scope, input.defaults.scope];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    if (input.grantedScopes.length === 0 || input.grantedScopes.includes(candidate)) return candidate;
  }
  const firstGranted = input.grantedScopes.find((scope) => scope !== '');
  if (firstGranted !== undefined) return firstGranted;
  throw new Error('situation has no authorized policy scope');
}

/** The sole service-layer answer to “where is this principal and what is in view?”. */
export function assembleSituation(input: SituationInput): Situation {
  const site = firstString(input.explicit?.site, input.presence?.site, input.defaults.site);
  const scope = scopeFrom(input);
  const thread =
    input.explicit?.thread ?? input.presence?.thread ?? input.defaults.thread ?? null;
  const focus = input.explicit?.focus ?? input.presence?.focus ?? input.defaults.focus ?? null;
  return {
    principal: input.principal,
    site,
    scope,
    thread,
    focus,
    disclosure: { scope, thread, focus },
  };
}
