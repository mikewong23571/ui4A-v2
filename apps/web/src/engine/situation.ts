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

/**
 * 展示/导航偏好槽位(D51 过渡):显式声明优先,否则取授予集合中第一个已登记
 * application。仅供响应元数据(effective-scope 头、sitemap 槽位、Draft 目标
 * 默认值)使用,禁止进入任何授权判定——授权一律吃授予集合 × 事实归属。
 */
export function declaredOrFirstGrantedApplication(
  identity: { policyScope?: string; grantedApplications: readonly string[] },
  authorizedApplications: readonly string[],
): string | undefined {
  if (identity.policyScope !== undefined && authorizedApplications.includes(identity.policyScope)) {
    return identity.policyScope;
  }
  return identity.grantedApplications.find((application) =>
    authorizedApplications.includes(application),
  );
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
