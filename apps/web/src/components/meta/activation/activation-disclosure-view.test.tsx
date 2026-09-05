// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MetaActivationDisclosure } from './activation-disclosure-view';
import { parseActivationDisclosure } from './activation-disclosure';

afterEach(cleanup);

const RELOGIN_VIEW = {
  kind: 'activation-visibility' as const,
  applications: [{ application: 'todo', outcome: 'visible-after-relogin' as const }],
  grantedApplications: ['development'],
  governanceExpansion: false,
};

describe('parseActivationDisclosure wire parser', () => {
  it('accepts the server contract shape', () => {
    expect(
      parseActivationDisclosure({
        kind: 'activation-visibility',
        applications: [{ application: 'todo', outcome: 'immediately-visible' }],
        grantedApplications: ['development'],
        governanceExpansion: true,
        browserLoginScopes: ['openid', 'ui4a:policy:governance'],
      }),
    ).toEqual({
      kind: 'activation-visibility',
      applications: [{ application: 'todo', outcome: 'immediately-visible' }],
      grantedApplications: ['development'],
      governanceExpansion: true,
      browserLoginScopes: ['openid', 'ui4a:policy:governance'],
    });
  });

  it('rejects malformed envelopes instead of rendering a fabricated disclosure', () => {
    for (const value of [
      undefined,
      null,
      {},
      { kind: 'other' },
      { kind: 'activation-visibility', applications: [], grantedApplications: [], governanceExpansion: false },
      { kind: 'activation-visibility', applications: [{ application: 'todo', outcome: 'unknown' }], grantedApplications: [], governanceExpansion: false },
    ]) {
      expect(parseActivationDisclosure(value)).toBeUndefined();
    }
  });
});

describe('MetaActivationDisclosure approver-facing receipt (D70.1)', () => {
  it('confirms immediate visibility and links into the application directory', () => {
    render(
      <MetaActivationDisclosure
        disclosure={{
          ...RELOGIN_VIEW,
          applications: [{ application: 'todo', outcome: 'immediately-visible' }],
        }}
      />,
    );

    expect(screen.getByText(/已对当前会话可见/)).toBeTruthy();
    expect(screen.getByText('todo')).toBeTruthy();
    const entry = screen.getByRole('link', { name: '前往应用目录' });
    expect(entry.getAttribute('href')).toBe('/applications');
  });

  it('recommends the refresh action for the relogin branch', () => {
    render(<MetaActivationDisclosure disclosure={RELOGIN_VIEW} />);

    expect(screen.getByText(/刷新授权后可见/)).toBeTruthy();
    const refresh = screen.getByRole('link', { name: '刷新授权' });
    expect(refresh.getAttribute('href')).toBe('/auth/login?returnTo=/applications');
  });

  it('names both sanctioned grant paths for the IdP branch (US7 wording snapshot)', () => {
    render(
      <MetaActivationDisclosure
        disclosure={{
          ...RELOGIN_VIEW,
          applications: [{ application: 'todo', outcome: 'requires-idp-grant' }],
        }}
      />,
    );

    const grantText = screen.getByText(/在部署配置的浏览器登录范围加入治理词/).textContent ?? '';
    expect(grantText).toContain('ui4a:policy:governance');
    expect(grantText).toContain('身份源为该应用配置逐 app 授权');
    expect(screen.getByRole('link', { name: '查看我的授权' }).getAttribute('href')).toBe(
      '/session',
    );
  });

  it('renders nothing without a parsed disclosure', () => {
    const { container } = render(<MetaActivationDisclosure disclosure={undefined} />);
    expect(container.textContent).toBe('');
  });
});
