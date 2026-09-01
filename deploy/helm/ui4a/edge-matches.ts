export type EdgeMethod = 'GET' | 'POST';
export type EdgeMatch = Readonly<{ method: EdgeMethod; path: string; kind?: 'prefix' }>;

export const webEdgeMatches: readonly EdgeMatch[] = [
  ...[
    '/',
    '/canvas',
    '/chat',
    '/delegations',
    '/entity',
    '/events',
    '/meta',
    '/favicon.ico',
    '/file.svg',
    '/globe.svg',
    '/next.svg',
    '/vercel.svg',
    '/window.svg',
    '/live',
    '/version',
    '/api/health',
    '/api/render/catalog',
    '/auth/login',
    '/auth/account',
    '/api/auth/callback',
    '/.well-known/ui4a.json',
    '/_meta/.well-known/ui4a.json',
    '/api/entity',
    '/api/events',
    '/api/chat/history',
    '/api/chat/sessions',
    '/api/delegations',
    '/_meta/api/entity',
    '/api/presentation/sidecar',
    '/applications',
  ].map((path): EdgeMatch => ({ method: 'GET', path })),
  { method: 'GET', path: '/api/delegations/', kind: 'prefix' },
  { method: 'GET', path: '/meta/', kind: 'prefix' },
  { method: 'GET', path: '/_next/', kind: 'prefix' },
  ...[
    '/auth/logout',
    '/api/exec',
    '/api/exec-plan',
    '/api/chat',
    '/api/presence',
    '/_meta/api/exec',
    '/api/presentation',
    '/api/presentation/sidecar',
  ].map((path): EdgeMatch => ({ method: 'POST', path })),
];

export const keycloakEdgeMatches: readonly EdgeMatch[] = [
  ...[
    '/realms/ui4a/.well-known/openid-configuration',
    '/realms/ui4a/protocol/openid-connect/auth',
    '/realms/ui4a/protocol/openid-connect/certs',
    '/realms/ui4a/protocol/openid-connect/logout',
    '/realms/ui4a/account',
  ].map((path): EdgeMatch => ({ method: 'GET', path })),
  { method: 'GET', path: '/realms/ui4a/account/', kind: 'prefix' },
  { method: 'GET', path: '/realms/ui4a/login-actions/', kind: 'prefix' },
  { method: 'GET', path: '/resources/', kind: 'prefix' },
  ...[
    '/realms/ui4a/protocol/openid-connect/token',
    '/realms/ui4a/protocol/openid-connect/revoke',
    '/realms/ui4a/protocol/openid-connect/logout',
    '/realms/ui4a/account',
  ].map((path): EdgeMatch => ({ method: 'POST', path })),
  { method: 'POST', path: '/realms/ui4a/account/', kind: 'prefix' },
  { method: 'POST', path: '/realms/ui4a/login-actions/', kind: 'prefix' },
];

export const internalCallbackPaths = ['/api/internal/agent-run-callback'] as const;
