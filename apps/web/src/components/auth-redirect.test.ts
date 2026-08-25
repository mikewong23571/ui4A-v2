import { describe, expect, it, vi } from 'vitest';

import { redirectToLoginOnAuthError } from './auth-redirect';

// 浏览器 401 认证错误统一跳转(T22 验证修复):
// - 认证类错误码(凭证/Session 缺失或失效)→ /auth/login?returnTo=<当前路径>;
// - 403/scope_insufficient 等授权失败、非 401、非认证码、无形体 body 均不跳转;
// - window 不存在(SSR)时静默返回 false。
// 测试注入 navigation(等价于 stub window.location.assign,jsdom 不可重定义 location)。

function navigation(pathname = '/', search = '') {
  const assign = vi.fn<(url: string) => void>();
  return { pathname, search, assign };
}

describe('redirectToLoginOnAuthError', () => {
  it.each([
    'credential_missing',
    'credential_malformed',
    'credential_expired',
    'credential_not_active',
    'session_cookie_invalid',
    'session_not_found',
    'session_expired',
    'session_revoked',
  ])('redirects to login for 401 %s', (code) => {
    const nav = navigation('/entity', '?rel=post%3Afirst');

    const redirected = redirectToLoginOnAuthError(401, { error: { code } }, nav);

    expect(redirected).toBe(true);
    expect(nav.assign).toHaveBeenCalledWith(
      `/auth/login?returnTo=${encodeURIComponent('/entity?rel=post%3Afirst')}`,
    );
  });

  it('does not redirect for 403 scope_insufficient (credential valid, insufficient grant)', () => {
    const nav = navigation();

    expect(redirectToLoginOnAuthError(403, { error: { code: 'scope_insufficient' } }, nav)).toBe(
      false,
    );
    expect(redirectToLoginOnAuthError(401, { error: { code: 'scope_insufficient' } }, nav)).toBe(
      false,
    );
    expect(nav.assign).not.toHaveBeenCalled();
  });

  it.each([
    ['non-401 status with an auth code', 500, { error: { code: 'credential_missing' } }],
    ['unknown error code', 401, { error: { code: 'jwks_unavailable' } }],
    ['plain string error body', 401, { error: 'afterSeq 必须是非负整数' }],
    ['empty body', 401, {}],
    ['non-object body', 401, null],
  ])('does not redirect for %s', (_name, status, body) => {
    const nav = navigation();

    expect(redirectToLoginOnAuthError(status as number, body, nav)).toBe(false);
    expect(nav.assign).not.toHaveBeenCalled();
  });

  it('returns false without a window (SSR) instead of throwing', () => {
    expect(redirectToLoginOnAuthError(401, { error: { code: 'credential_missing' } })).toBe(false);
  });
});
