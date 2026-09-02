import { describe, expect, it } from 'vitest';

import { resolveTrustedRequestOrigin } from './request-origin';

const publicOrigin = 'https://ui4a.styleofwong.cn';
const internalOrigin = 'https://ui4a.home-linux.tail.styleofwong.com';
const trusted = [publicOrigin, internalOrigin];

describe('trusted external request origin', () => {
  it.each([publicOrigin, internalOrigin])('accepts allowlisted HTTPS origin %s', (origin) => {
    const request = new Request('http://web:3100/api/chat', {
      headers: { host: new URL(origin).host, 'x-forwarded-proto': 'https' },
    });
    expect(resolveTrustedRequestOrigin(request, trusted)).toBe(origin);
  });

  it.each([
    ['unknown host', { host: 'evil.internal', 'x-forwarded-proto': 'https' }],
    ['plain HTTP', { host: 'ui4a.styleofwong.cn', 'x-forwarded-proto': 'http' }],
    ['ambiguous proto', { host: 'ui4a.styleofwong.cn', 'x-forwarded-proto': 'https,http' }],
    ['ambiguous host', { host: 'ui4a.styleofwong.cn,evil.internal', 'x-forwarded-proto': 'https' }],
  ])('rejects %s', (_case, headers) => {
    expect(
      resolveTrustedRequestOrigin(new Request('http://web:3100/api/chat', { headers }), trusted),
    ).toBeUndefined();
  });
});
