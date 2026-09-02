// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BROWSER_SESSION_COOKIE_NAME } from '@/auth/browser-session';

import { SessionAwareSiteNav } from './session-aware-site-nav';

const requestCookies = vi.hoisted(() => ({ has: vi.fn(), read: vi.fn() }));

vi.mock('next/headers', () => ({ cookies: requestCookies.read }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

beforeEach(() => {
  requestCookies.has.mockReset();
  requestCookies.read.mockReset();
  requestCookies.read.mockResolvedValue({ has: requestCookies.has });
});

afterEach(cleanup);

async function renderNavigation(): Promise<void> {
  render(await SessionAwareSiteNav());
  fireEvent.click(screen.getByRole('button', { name: /系统/ }));
}

describe('request-time session controls navigation', () => {
  it('renders account and POST logout controls when the browser session cookie exists', async () => {
    requestCookies.has.mockReturnValue(true);

    await renderNavigation();

    expect(requestCookies.has).toHaveBeenCalledWith(BROWSER_SESSION_COOKIE_NAME);
    expect(screen.getByRole('menuitem', { name: '账户与密码' }).getAttribute('href')).toBe(
      '/auth/account',
    );
    const logout = screen.getByRole('menuitem', { name: '退出登录' });
    expect(logout.closest('form')?.getAttribute('action')).toBe('/auth/logout');
    expect(logout.closest('form')?.getAttribute('method')).toBe('post');
  });

  it('does not expose unavailable account controls without a browser session cookie', async () => {
    requestCookies.has.mockReturnValue(false);

    await renderNavigation();

    expect(screen.queryByRole('menuitem', { name: '账户与密码' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: '退出登录' })).toBeNull();
  });

  it('keeps build-time deployment environment out of the shell UI decision', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'app-shell.tsx'), 'utf8');

    expect(source).not.toContain('process.env.UI4A_DEPLOYMENT_PROFILE');
    expect(source).toContain('<SessionAwareSiteNav />');
  });
});
