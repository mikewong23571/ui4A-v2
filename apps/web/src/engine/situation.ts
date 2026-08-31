import type { PresenceProjection, RenderSubject } from '@ui4a/shared';

/** Normalize trusted policy claims to the application names used by the assembler. */
export function grantedPolicyScopes(scopes: readonly string[]): string[] {
  return [
    ...new Set(
      scopes.flatMap((scope) =>
        scope.startsWith('ui4a:policy:')
          ? [scope.slice('ui4a:policy:'.length)]
          : scope.startsWith('ui4a:')
            ? []
            : [scope],
      ),
    ),
  ];
}

/** Return a valid explicitly declared attention lens; grants never create attention. */
export function declaredApplication(
  identity: { policyScope?: string; grantedApplications: readonly string[] },
  authorizedApplications: readonly string[],
): string | undefined {
  if (
    identity.policyScope !== undefined &&
    identity.grantedApplications.includes(identity.policyScope) &&
    authorizedApplications.includes(identity.policyScope)
  ) {
    return identity.policyScope;
  }
  return undefined;
}

export interface SituationExplicitParameters {
  site?: string;
  scope?: string | null;
  thread?: string | null;
  focus?: RenderSubject | null;
}

export interface SituationDefaults {
  site: string;
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
  scope?: string;
  thread: string | null;
  focus: RenderSubject | null;
}

export interface Situation {
  principal: string;
  site: string;
  scope?: string;
  thread: string | null;
  focus: RenderSubject | null;
  disclosure: SituationDisclosureSlice;
}

function firstString(...values: Array<string | null | undefined>): string {
  const value = values.find((entry): entry is string => entry !== undefined && entry !== '');
  if (value === undefined) throw new Error('situation requires a non-empty string');
  return value;
}

function scopeFrom(input: SituationInput): string | undefined {
  if (input.grantedScopes.length === 0) {
    throw new Error('situation has no authorized policy scope');
  }
  if (input.explicit?.scope === null || input.explicit?.scope === '') return undefined;
  const candidates = [input.explicit?.scope, input.presence?.scope];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    if (input.grantedScopes.includes(candidate)) return candidate;
  }
  return undefined;
}

/** The sole service-layer answer to “where is this principal and what is in view?”. */
export function assembleSituation(input: SituationInput): Situation {
  const site = firstString(input.explicit?.site, input.presence?.site, input.defaults.site);
  const scope = scopeFrom(input);
  const thread =
    input.explicit?.thread !== undefined
      ? input.explicit.thread
      : (input.presence?.thread ?? input.defaults.thread ?? null);
  const focus =
    input.explicit?.focus !== undefined
      ? input.explicit.focus
      : (input.presence?.focus ?? input.defaults.focus ?? null);
  return {
    principal: input.principal,
    site,
    scope,
    thread,
    focus,
    disclosure: { scope, thread, focus },
  };
}
