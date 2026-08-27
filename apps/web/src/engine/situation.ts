import type { EngineSnapshot, PresenceProjection, RenderSubject } from '@ui4a/shared';
import type { Sitemap } from '@ui4a/engine';

import { relCoveredByPolicyScope } from '../auth/application-scope';

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

/**
 * 从已授予 scope 集合中按数组顺序确定性地选第一个覆盖目标 rel 的 scope
 * (与 resolveCredentialPolicyScope 的 scopeCoverage 选择同口径)。供目标 rel 在
 * 身份解析后才出现的调用方(如 Presentation Broker)在授权点做覆盖选择;
 * 无覆盖者返回 undefined,与授权失败同语义,不扩大授权。
 */
export function selectCoveringPolicyScope(
  context: { snapshot: EngineSnapshot; sitemap: Sitemap; plane: 'business' | 'meta' },
  rel: string,
  grantedScopes: readonly string[],
): string | undefined {
  return grantedScopes.find((scope) => relCoveredByPolicyScope(context, rel, scope));
}

export interface SituationExplicitParameters {
  site?: string;
  scope?: string | null;
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
  // Fail-closed (D48-R8): an empty grant envelope means nothing is authorized,
  // so every candidate below is rejected by the membership check and this throws.
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    if (input.grantedScopes.includes(candidate)) return candidate;
  }
  const firstGranted = input.grantedScopes.find((scope) => scope !== '');
  if (firstGranted !== undefined) return firstGranted;
  throw new Error('situation has no authorized policy scope');
}

/** The sole service-layer answer to “where is this principal and what is in view?”. */
export function assembleSituation(input: SituationInput): Situation {
  const site = firstString(input.explicit?.site, input.presence?.site, input.defaults.site);
  const scope = scopeFrom(input);
  const thread = input.explicit?.thread ?? input.presence?.thread ?? input.defaults.thread ?? null;
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
