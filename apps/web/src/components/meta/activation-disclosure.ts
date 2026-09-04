/**
 * 激活可见性披露的客户端视图合同(D70.1,T51):严格解析 meta exec 响应中的
 * `disclosure` 载荷——malformed 一律 undefined(不渲染伪造披露)。服务端权威类型
 * 在 `apps/web/src/auth/activation-disclosure.ts`;两侧形状由路由合同测试的
 * 精确 toEqual 字面量互相钉住,漂移即红。
 */
export type ActivationDisclosureOutcome =
  | 'immediately-visible'
  | 'visible-after-relogin'
  | 'requires-idp-grant';

export interface ActivationDisclosureView {
  kind: 'activation-visibility';
  applications: { application: string; outcome: ActivationDisclosureOutcome }[];
  grantedApplications: string[];
  governanceExpansion: boolean;
  browserLoginScopes?: string[];
}

const OUTCOMES: readonly ActivationDisclosureOutcome[] = [
  'immediately-visible',
  'visible-after-relogin',
  'requires-idp-grant',
];

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === 'string' && item !== '') ? [...value] : undefined;
}

/** Strict wire parser; undefined for anything outside the declared contract. */
export function parseActivationDisclosure(value: unknown): ActivationDisclosureView | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'activation-visibility') return undefined;
  if (!Array.isArray(candidate.applications) || candidate.applications.length === 0) {
    return undefined;
  }
  const applications: ActivationDisclosureView['applications'] = [];
  for (const entry of candidate.applications) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.application !== 'string' ||
      record.application === '' ||
      typeof record.outcome !== 'string' ||
      !OUTCOMES.includes(record.outcome as ActivationDisclosureOutcome)
    ) {
      return undefined;
    }
    applications.push({
      application: record.application,
      outcome: record.outcome as ActivationDisclosureOutcome,
    });
  }
  const grantedApplications = stringList(candidate.grantedApplications);
  if (grantedApplications === undefined) return undefined;
  if (typeof candidate.governanceExpansion !== 'boolean') return undefined;
  const browserLoginScopes = stringList(candidate.browserLoginScopes);
  return {
    kind: 'activation-visibility',
    applications,
    grantedApplications,
    governanceExpansion: candidate.governanceExpansion,
    ...(browserLoginScopes === undefined || candidate.browserLoginScopes === undefined
      ? {}
      : { browserLoginScopes }),
  };
}
