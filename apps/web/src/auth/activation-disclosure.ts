/**
 * 激活可见性披露(D70.1,T51):application-bundle 批准通过瞬间,对批准者本人
 * 推导「新装应用 × 其当前会话授权」的可见性结论与恢复动作。纯函数、零 I/O;
 * 输入三事实(新装应用、批准者有效授予集合含 D66.4 展开、运行时浏览器登录
 * scope 表),输出表现层回执——不落事件日志、不进跨 principal 面(存在性不泄露)。
 */
import type { ProductionDeploymentConfig } from '@ui4a/shared';

import { runWebProductionDeploymentPreflight } from '../production-deployment-preflight';

import { requestIdentityProfile } from './request-identity';

/** 治理授予词(D66.4):出现在浏览器登录 scope 表时,重登即可拿到展开推导。 */
export const GOVERNANCE_LOGIN_SCOPE = 'ui4a:policy:governance';

export type ActivationDisclosureOutcome =
  | 'immediately-visible'
  | 'visible-after-relogin'
  | 'requires-idp-grant';

export interface ActivationDisclosureApplication {
  application: string;
  outcome: ActivationDisclosureOutcome;
}

export interface ActivationDisclosure {
  kind: 'activation-visibility';
  /** 按应用名字典序的确定性分类列表。 */
  applications: ActivationDisclosureApplication[];
  /** 批准者有效授予集合(含治理展开;去重回显,供面板与审计对照)。 */
  grantedApplications: string[];
  /** 授予集合是否经治理词展开得到(D66.4 溯源标注)。 */
  governanceExpansion: boolean;
  /** 生产 profile 下的浏览器登录 scope 表;local 模式为 undefined(无重登通道)。 */
  browserLoginScopes?: string[];
}

export interface ActivationDisclosureInput {
  newApplications: readonly string[];
  grantedApplications: readonly string[];
  tokenScopes: readonly string[];
  browserLoginScopes: readonly string[] | undefined;
}

function outcomeFor(
  application: string,
  input: ActivationDisclosureInput,
): ActivationDisclosureOutcome {
  if (input.grantedApplications.includes(application)) return 'immediately-visible';
  // D70.1 附录:治理词或该应用的逐 app 词任一在登录 scope 表内,刷新授权即可见。
  // 当前 settings 校验器限定六固定词,逐 app 分支留给 realm 演进,判定语义不变。
  if (
    input.browserLoginScopes?.some(
      (scope) => scope === GOVERNANCE_LOGIN_SCOPE || scope === `ui4a:policy:${application}`,
    ) === true
  ) {
    return 'visible-after-relogin';
  }
  return 'requires-idp-grant';
}

/** Derive the approver-facing visibility disclosure; undefined when nothing new was installed. */
export function computeActivationDisclosure(
  input: ActivationDisclosureInput,
): ActivationDisclosure | undefined {
  const newApplications = [...new Set(input.newApplications)].filter(
    (application) => application !== '',
  );
  if (newApplications.length === 0) return undefined;
  newApplications.sort();
  return {
    kind: 'activation-visibility',
    applications: newApplications.map((application) => ({
      application,
      outcome: outcomeFor(application, input),
    })),
    grantedApplications: [...new Set(input.grantedApplications)],
    governanceExpansion: input.tokenScopes.includes(GOVERNANCE_LOGIN_SCOPE),
    ...(input.browserLoginScopes === undefined
      ? {}
      : { browserLoginScopes: [...input.browserLoginScopes] }),
  };
}

/**
 * 生产 profile 下返回运行时浏览器登录 scope 表(新授权请求会携带的集合);
 * local 模式返回 undefined。路由在 credential 模式才用它判 relogin 可行性。
 */
export function browserLoginPolicyScopes(
  options: { environment?: NodeJS.ProcessEnv; productionConfig?: ProductionDeploymentConfig } = {},
): readonly string[] | undefined {
  if (requestIdentityProfile(options.environment) !== 'production') return undefined;
  const config =
    options.productionConfig ?? runWebProductionDeploymentPreflight(options.environment);
  if (config === undefined) return undefined;
  return config.settings.auth.oidc.scopes;
}
