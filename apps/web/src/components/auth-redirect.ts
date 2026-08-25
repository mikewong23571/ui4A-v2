/**
 * 浏览器端 401 认证错误统一跳转(T22 验证修复)。
 *
 * 生产 credential 模式下,合同端点对缺失/失效凭证返回 401 + { error: { code } };
 * 页面此前只显示"读取合同失败"而不引导登录。认证类错误码统一跳转
 * /auth/login?returnTo=<当前路径>(safeReturnTo 在服务端再做同源校验);
 * 403/scope_insufficient 等授权失败不跳转(凭证有效但权限不足,登录无意义)。
 */

/** 可注入的导航面(测试注入;缺省取 window.location)。 */
export interface LoginRedirectNavigation {
  pathname: string;
  search: string;
  assign(url: string): void;
}

/** 需要重新登录的认证错误码(与 auth/request-identity 的 401 口径一致)。 */
const LOGIN_REDIRECT_CODES = new Set([
  'credential_missing',
  'credential_malformed',
  'credential_expired',
  'credential_not_active',
  'session_cookie_invalid',
  'session_not_found',
  'session_expired',
  'session_revoked',
]);

function errorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function defaultNavigation(): LoginRedirectNavigation | undefined {
  // 本文件会被无 DOM lib 的 workspace(worker typecheck)间接解析,不能出现裸 `window` 引用。
  const candidate = (globalThis as { window?: unknown }).window;
  if (typeof candidate !== 'object' || candidate === null) return undefined;
  const location = (candidate as { location?: unknown }).location;
  if (typeof location !== 'object' || location === null) return undefined;
  const { pathname, search, assign } = location as {
    pathname?: unknown;
    search?: unknown;
    assign?: unknown;
  };
  if (typeof pathname !== 'string' || typeof search !== 'string' || typeof assign !== 'function') {
    return undefined;
  }
  return {
    pathname,
    search,
    assign: (url: string) => (assign as (target: string) => void).call(location, url),
  };
}

/** 认证类 401 → 跳转登录并返回 true;其他情况返回 false(调用方照常处理错误)。 */
export function redirectToLoginOnAuthError(
  status: number,
  body: unknown,
  navigation?: LoginRedirectNavigation,
): boolean {
  const target = navigation ?? defaultNavigation();
  if (target === undefined || status !== 401) return false;
  const code = errorCode(body);
  if (code === undefined || !LOGIN_REDIRECT_CODES.has(code)) return false;
  target.assign(`/auth/login?returnTo=${encodeURIComponent(target.pathname + target.search)}`);
  return true;
}
