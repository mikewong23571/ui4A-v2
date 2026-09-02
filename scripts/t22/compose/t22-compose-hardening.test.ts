import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  contractPath,
  coreServices,
  dependency,
  digest,
  edgeRoutingSource,
  initServices,
  loadRenderer,
  longRunningServices,
  plannedVolumes,
  publishedContainerPorts,
  renderInput,
  renderedStack,
  repositoryRoot,
  requiredJson,
  requiredSource,
  staticRenderInput,
  volumeNames,
} from './t22-compose-test-helpers';

describe('T22 Docker Compose identity, mounts, edges and recovery hooks', () => {
  it('mounts canonical sources only into root copy-init and PKI bootstrap', async () => {
    const stack = await renderedStack();

    expect(stack.configs['ui4a-deployment-settings']).toEqual({
      file: renderInput().settingsFile,
    });
    expect(stack.secrets['ui4a-deployment-secrets']).toEqual({
      file: renderInput().secretsFile,
    });
    for (const name of ['migration', 'realm-bootstrap', 'web', 'worker']) {
      const service = stack.services[name];
      expect(service?.environment).toMatchObject({
        UI4A_DEPLOYMENT_PROFILE: 'production',
        UI4A_DEPLOYMENT_SETTINGS_FILE: '/var/run/ui4a/runtime-config/settings.json',
        UI4A_DEPLOYMENT_SECRETS_FILE: '/var/run/ui4a/runtime-config/deployment-secrets.json',
      });
      expect(service?.configs ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'ui4a-deployment-settings' }),
      );
      expect(service?.secrets ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'ui4a-deployment-secrets' }),
      );
    }
    for (const name of ['runner', 'host-runner']) {
      const service = stack.services[name];
      expect(service?.environment).toMatchObject({ UI4A_DEPLOYMENT_PROFILE: 'production' });
      expect(service?.configs ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'ui4a-deployment-settings' }),
      );
      expect(service?.secrets ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'ui4a-deployment-secrets' }),
      );
    }
    for (const name of ['config-init', 'pki-init']) {
      expect(stack.services[name]?.configs).toContainEqual({
        source: 'ui4a-deployment-settings',
        target: '/run/ui4a/settings.json',
        mode: 0o400,
      });
      expect(stack.services[name]?.secrets).toContainEqual({
        source: 'ui4a-deployment-secrets',
        target: 'ui4a-deployment-secrets',
        mode: 0o400,
      });
    }
  });

  it('mounts one callback credential file only into Web and Worker startup', async () => {
    const stack = await renderedStack();

    expect(stack.secrets['capability-callback-token']).toEqual({
      file: '/srv/ui4a/secrets/capability-callback-token',
    });
    for (const name of ['web', 'worker']) {
      expect(stack.services[name]?.environment).toMatchObject({
        UI4A_CAPABILITY_CALLBACK_TOKEN_FILE:
          '/var/run/ui4a/runtime-config/capability-callback-token',
      });
      expect(stack.services[name]?.secrets ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'capability-callback-token' }),
      );
    }
    for (const name of ['migration', 'realm-bootstrap', 'runner', 'host-runner']) {
      expect(stack.services[name]?.environment).not.toHaveProperty(
        'UI4A_CAPABILITY_CALLBACK_TOKEN_FILE',
      );
      expect(stack.services[name]?.secrets ?? []).not.toContainEqual(
        expect.objectContaining({ source: 'capability-callback-token' }),
      );
    }
    expect(stack.services['config-init']?.secrets).toContainEqual({
      source: 'capability-callback-token',
      target: 'capability-callback-token',
      mode: 0o400,
    });
    expect(JSON.stringify(stack)).not.toContain('__private_callback_material__');
  });

  it('hands rootless bind-backed inputs to every Node consumer without widening source modes', async () => {
    const stack = await renderedStack();
    const init = stack.services['config-init'];
    const consumers = ['migration', 'realm-bootstrap', 'web', 'worker'];
    const runtimeRoot = '/var/run/ui4a/runtime-config';

    expect(init).toMatchObject({
      image: renderInput().images.worker,
      user: '0:0',
      restart: 'no',
      read_only: true,
      command: ['node', '/opt/ui4a/config-init.mjs'],
    });
    expect(init?.configs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'ui4a-config-init',
          target: '/opt/ui4a/config-init.mjs',
        }),
        expect.objectContaining({ source: 'ui4a-deployment-settings' }),
      ]),
    );
    expect(init?.secrets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'ui4a-deployment-secrets' }),
        expect.objectContaining({ source: 'capability-callback-token' }),
      ]),
    );
    expect(init?.volumes).toContain(`runtime-config:${runtimeRoot}`);
    expect(init?.volumes).toContain('runner-config:/var/run/ui4a/runner-config');
    expect(init?.volumes).toContain('host-runner-config:/var/run/ui4a/host-runner-config');
    expect(stack.configs['ui4a-config-init']).toEqual({ file: 'deploy/compose/config-init.mjs' });

    for (const name of consumers) {
      const service = stack.services[name];
      expect(service?.user, name).toBe('1000:1000');
      expect(dependency(stack, name, 'config-init'), name).toBe('service_completed_successfully');
      expect(service?.environment, name).toMatchObject({
        UI4A_DEPLOYMENT_SETTINGS_FILE: `${runtimeRoot}/settings.json`,
        UI4A_DEPLOYMENT_SECRETS_FILE: `${runtimeRoot}/deployment-secrets.json`,
      });
      expect(service?.volumes, name).toContain(`runtime-config:${runtimeRoot}:ro`);
      expect(service?.configs ?? [], name).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ source: 'ui4a-deployment-settings' })]),
      );
      expect(service?.secrets ?? [], name).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ source: 'ui4a-deployment-secrets' })]),
      );
    }
    for (const name of ['web', 'worker']) {
      expect(stack.services[name]?.environment).toMatchObject({
        UI4A_CAPABILITY_CALLBACK_TOKEN_FILE: `${runtimeRoot}/capability-callback-token`,
      });
    }
    for (const [name, root] of [
      ['runner', '/var/run/ui4a/runner-config'],
      ['host-runner', '/var/run/ui4a/host-runner-config'],
    ] as const) {
      const service = stack.services[name];
      expect(service?.environment).toMatchObject({
        UI4A_DEPLOYMENT_SETTINGS_FILE: `${root}/settings.json`,
        UI4A_DEPLOYMENT_SECRETS_FILE: `${root}/runner-secrets.json`,
      });
      expect(service?.volumes).toContain(`${name}-config:${root}:ro`);
      expect(service?.volumes).not.toContain(`runtime-config:${runtimeRoot}:ro`);
    }
  });

  it('does not serialize Secret material or request-selected Runtime overrides', async () => {
    const stackSource = JSON.stringify(await renderedStack());

    for (const forbidden of [
      'correct-horse-battery-staple',
      'LLM_API_KEY=',
      'POSTGRES_PASSWORD=',
      'KEYCLOAK_ADMIN_PASSWORD=',
      'UI4A_RUNTIME_BACKEND=',
      'UI4A_RUNTIME_IMAGE=',
      'UI4A_RUNTIME_CWD=',
      'UI4A_RUNTIME_PROVIDER=',
      'UI4A_RUNTIME_MODEL=',
    ]) {
      expect(stackSource).not.toContain(forbidden);
    }
  });

  it('reuses the bounded realm import-or-check and migration commands without drift repair', async () => {
    const stack = await renderedStack();
    const realmCommand = stack.services['realm-bootstrap']?.command?.join(' ') ?? '';
    const migrationCommand = stack.services.migration?.command?.join(' ') ?? '';

    expect(realmCommand).toMatch(/t22-keycloak-realm-bootstrap.+--apply/);
    expect(realmCommand).not.toMatch(/reconcile|drift|repair/i);
    expect(migrationCommand).toMatch(/t22-migrate/);
    expect(stack.services['host-runner']?.image).toBe(stack.services.runner?.image);
  });

  it('initializes persisted PKI before exposing the rootless local HTTPS edge', async () => {
    const stack = await renderedStack();
    const pki = stack.services['pki-init'];
    const edge = stack.services.edge;

    expect(pki).toMatchObject({
      image: renderInput().images.runner,
      restart: 'no',
      user: '0:0',
      read_only: true,
      command: ['node', 'dist/main.js', 'pki-init'],
    });
    expect(pki?.volumes).toContain('experiment-ca:/var/lib/ui4a/ca');
    expect(pki?.environment).toMatchObject({
      UI4A_PKI_ROOT: '/var/lib/ui4a/ca',
      UI4A_HOST: 'ui4a.mothership.internal',
      KEYCLOAK_HOST: 'auth.ui4a.mothership.internal',
    });

    expect(edge).toMatchObject({
      image: renderInput().images.edge,
      restart: 'unless-stopped',
      user: '1000:1000',
      read_only: true,
      ports: ['127.0.0.1:8443:8080'],
    });
    expect(edge?.volumes).toContain('experiment-ca:/var/lib/ui4a/ca:ro');
    expect(edge?.volumes).toContain('deploy/compose/edge-routing.caddy:/etc/caddy/Caddyfile:ro');
    expect(edge?.configs ?? []).not.toContainEqual(
      expect.objectContaining({ source: 'ui4a-edge-routing' }),
    );
    expect(dependency(stack, 'edge', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'edge', 'web')).toBeUndefined();
    expect(dependency(stack, 'edge', 'keycloak')).toBeUndefined();
    expect(dependency(stack, 'web', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'keycloak', 'pki-init')).toBe('service_completed_successfully');
    expect(stack.services.web?.ports ?? []).toEqual([]);
  });

  it('routes public and internal hosts through one HTTP gateway while retaining internal TLS', async () => {
    const stack = await renderedStack();
    const routing = edgeRoutingSource();

    expect(routing).toContain('https://{$UI4A_HOST}:8443');
    expect(routing).toContain('tls /var/lib/ui4a/ca/ui4a/tls.crt /var/lib/ui4a/ca/ui4a/tls.key');
    expect(routing).toContain('reverse_proxy web:3100');
    expect(routing).toContain(':8080');
    expect(routing).toContain(
      '@keycloakHost host {$KEYCLOAK_PUBLIC_HOST} {$KEYCLOAK_INTERNAL_HOST}',
    );
    expect(routing).toContain(
      'tls /var/lib/ui4a/ca/keycloak/tls.crt /var/lib/ui4a/ca/keycloak/tls.key',
    );
    expect(routing).toContain('reverse_proxy keycloak:8080');
    expect(routing).toContain('/realms/ui4a/account');
    expect(routing).toContain('/realms/ui4a/account/*');
    expect(stack.services.edge?.environment).toMatchObject({
      UI4A_HOST: 'ui4a.mothership.internal',
      KEYCLOAK_HOST: 'auth.ui4a.mothership.internal',
    });
  });

  it('separates operator public origins and published port from internal TLS listeners', async () => {
    const renderer = await loadRenderer();
    const input = renderInput();
    input.edge = {
      webPublicOrigin: 'https://ui4a.styleofwong.cn',
      keycloakPublicOrigin: 'https://auth.ui4a.styleofwong.cn',
      trustedRequestOrigins: [
        'https://ui4a.styleofwong.cn',
        'https://ui4a.home-linux.tail.styleofwong.com',
      ],
      ui4aTlsHost: 'ui4a.home-linux.tail.styleofwong.com',
      keycloakTlsHost: 'auth-ui4a.home-linux.tail.styleofwong.com',
      bindAddress: '100.64.0.2',
      publishedPort: 10443,
    } as typeof input.edge;

    const stack = renderer.renderComposeStack(input);

    expect(stack.services.keycloak?.environment?.KC_HOSTNAME).toBe(input.edge.keycloakPublicOrigin);
    expect(stack.services['pki-init']?.environment).toMatchObject({
      UI4A_HOST: 'ui4a.home-linux.tail.styleofwong.com',
      KEYCLOAK_HOST: 'auth-ui4a.home-linux.tail.styleofwong.com',
    });
    expect(stack.services.edge?.ports).toEqual(['100.64.0.2:10443:8080']);
    expect(stack.services.edge?.networks?.default?.aliases).toEqual([
      'ui4a.home-linux.tail.styleofwong.com',
      'auth-ui4a.home-linux.tail.styleofwong.com',
    ]);
    expect(stack.services.worker?.environment?.UI4A_HOST_RUNNER_ORIGINS).toBe(
      '{"compose-container-runner":"https://ui4a.home-linux.tail.styleofwong.com:8443","compose-host-runner":"https://ui4a.home-linux.tail.styleofwong.com:9444"}',
    );
    expect(stack.services.edge?.environment).toMatchObject({
      UI4A_PUBLIC_HOST: 'ui4a.styleofwong.cn',
      UI4A_INTERNAL_HOST: 'ui4a.home-linux.tail.styleofwong.com',
      KEYCLOAK_PUBLIC_HOST: 'auth.ui4a.styleofwong.cn',
      KEYCLOAK_INTERNAL_HOST: 'auth-ui4a.home-linux.tail.styleofwong.com',
    });
    expect(edgeRoutingSource()).toContain(':8080');
    expect(edgeRoutingSource()).toContain('header_up X-Forwarded-Proto https');
    expect(edgeRoutingSource()).toMatch(
      /https:\/\/\{\$UI4A_HOST\}:8443\s*\{[\s\S]*handle \/deliver[\s\S]*respond 404[\s\S]*\}/,
    );
    expect(edgeRoutingSource()).not.toContain('https://{$KEYCLOAK_HOST}:8443');
    expect(edgeRoutingSource()).toContain('https://{$UI4A_HOST}:9444');
    expect(edgeRoutingSource()).toContain('https://{$KEYCLOAK_HOST}:9443');
  });

  it('rejects insecure, path-bearing, same-host, or privileged edge inputs', async () => {
    const renderer = await loadRenderer();
    const cases = [
      {
        webPublicOrigin: 'http://ui4a.home.internal',
        keycloakPublicOrigin: 'https://auth.home.internal',
        trustedRequestOrigins: ['https://ui4a.home.internal'],
        ui4aTlsHost: 'ui4a.internal',
        keycloakTlsHost: 'auth.internal',
        bindAddress: '127.0.0.1',
        publishedPort: 10_443,
      },
      {
        webPublicOrigin: 'https://ui4a.home.internal/path',
        keycloakPublicOrigin: 'https://auth.home.internal',
        trustedRequestOrigins: ['https://ui4a.home.internal'],
        ui4aTlsHost: 'ui4a.internal',
        keycloakTlsHost: 'auth.internal',
        bindAddress: '127.0.0.1',
        publishedPort: 10_443,
      },
      {
        webPublicOrigin: 'https://ui4a.home.internal',
        keycloakPublicOrigin: 'https://ui4a.home.internal',
        trustedRequestOrigins: ['https://ui4a.home.internal'],
        ui4aTlsHost: 'ui4a.internal',
        keycloakTlsHost: 'auth.internal',
        bindAddress: '127.0.0.1',
        publishedPort: 10_443,
      },
      {
        webPublicOrigin: 'https://ui4a.home.internal',
        keycloakPublicOrigin: 'https://auth.home.internal',
        trustedRequestOrigins: ['https://ui4a.home.internal'],
        ui4aTlsHost: 'ui4a.internal',
        keycloakTlsHost: 'auth.internal',
        bindAddress: '127.0.0.1',
        publishedPort: 443,
      },
    ];

    for (const edge of cases) {
      expect(() => renderer.renderComposeStack({ ...renderInput(), edge })).toThrow(
        /edge|HTTPS|origin|port/i,
      );
    }
  });

  it('wires the server-owned Compose Runner identity and HTTPS origin without token material', async () => {
    const stack = await renderedStack();
    const worker = stack.services.worker;
    const runner = stack.services.runner;

    expect(worker?.environment).toMatchObject({
      UI4A_RUNNER_IMAGE: renderInput().images.runner,
      UI4A_HOST_RUNNER_ORIGINS:
        '{"compose-container-runner":"https://ui4a.mothership.internal:8443","compose-host-runner":"https://ui4a.mothership.internal:9444"}',
      NODE_EXTRA_CA_CERTS: '/var/lib/ui4a/ca/root-ca.crt',
    });
    expect(runner?.environment).toMatchObject({
      UI4A_RUNNER_ID: 'compose-container-runner',
      UI4A_RUNNER_IMAGE: renderInput().images.runner,
    });
    for (const serviceName of ['worker', 'runner', 'realm-bootstrap', 'migration']) {
      const service = stack.services[serviceName];
      expect(service?.environment?.NODE_EXTRA_CA_CERTS, serviceName).toBe(
        '/var/lib/ui4a/ca/root-ca.crt',
      );
      expect(service?.volumes, serviceName).toContain('experiment-ca:/var/lib/ui4a/ca:ro');
    }
    expect(dependency(stack, 'runner', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'migration', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'worker', 'edge')).toBe('service_healthy');
    expect(dependency(stack, 'edge', 'runner')).toBeUndefined();
    expect(
      JSON.stringify({ worker: worker?.environment, runner: runner?.environment }),
    ).not.toMatch(/Bearer |runner-token|authorization/i);
  });

  it('gives only Worker the server-owned internal callback origin', async () => {
    const stack = await renderedStack();
    const compose = requiredSource('deploy/compose/compose.yaml');
    const contract = requiredJson<StackContract & { runnerDelivery: Record<string, unknown> }>(
      contractPath,
    );

    expect(stack.services.worker?.environment).toMatchObject({
      UI4A_PUBLIC_BASE_URL: 'http://web:3100',
    });
    for (const name of ['web', 'runner', 'host-runner']) {
      expect(stack.services[name]?.environment, name).not.toHaveProperty('UI4A_PUBLIC_BASE_URL');
    }
    expect(compose.match(/UI4A_PUBLIC_BASE_URL/g)).toHaveLength(1);
    expect(contract.runnerDelivery).toMatchObject({
      workerCallbackOrigin: 'http://web:3100',
    });
  });

  it('shares the server-owned document workspace only with Worker and both Runners', async () => {
    const stack = await renderedStack();
    const compose = requiredSource('deploy/compose/compose.yaml');
    const contract = requiredJson<StackContract & { runnerDelivery: Record<string, unknown> }>(
      contractPath,
    );

    for (const name of ['worker', 'runner', 'host-runner']) {
      expect(stack.services[name]?.volumes, name).toContain('runner-workspaces:/workspaces');
    }
    expect(stack.services.web?.volumes).not.toContain('runner-workspaces:/workspaces');
    expect(compose.match(/runner-workspaces:\/workspaces/g)).toHaveLength(3);
    expect(contract.runnerDelivery).toMatchObject({
      workerWorkspaceVolume: 'runner-workspaces:/workspaces',
    });
  });

  it('wires independent container and Host Runner identities, origins, and token refs without fallback', async () => {
    const contract = requiredJson<StackContract>(contractPath);
    const stack = await renderedStack();
    const worker = stack.services.worker;
    const containerRunner = stack.services.runner;
    const hostRunner = stack.services['host-runner'];
    const routing = edgeRoutingSource();

    expect(contract.dualRuntime).toEqual({
      fallback: false,
      container: {
        service: 'runner',
        runnerId: 'compose-container-runner',
        tokenRef: 'compose-container-runner-token',
        origin: 'https://ui4a.mothership.internal:8443',
        route: '/deliver',
      },
      host: {
        service: 'host-runner',
        profile: 'host-runner',
        runnerId: 'compose-host-runner',
        tokenRef: 'compose-host-runner-token',
        origin: 'https://ui4a.mothership.internal:9444',
        route: '/deliver',
      },
    });
    expect(containerRunner?.environment).toMatchObject({
      UI4A_RUNNER_ID: contract.dualRuntime.container.runnerId,
    });
    expect(hostRunner?.environment).toMatchObject({
      UI4A_RUNNER_ID: contract.dualRuntime.host.runnerId,
    });
    expect(hostRunner?.profiles).toEqual([contract.dualRuntime.host.profile]);
    expect(JSON.parse(worker?.environment?.UI4A_HOST_RUNNER_ORIGINS ?? '{}')).toEqual({
      [contract.dualRuntime.container.runnerId]: contract.dualRuntime.container.origin,
      [contract.dualRuntime.host.runnerId]: contract.dualRuntime.host.origin,
    });
    expect(routing).toMatch(
      /https:\/\/\{\$UI4A_HOST\}:8443[\s\S]+handle \/deliver[\s\S]+reverse_proxy runner:3102/,
    );
    expect(routing).toMatch(
      /https:\/\/\{\$UI4A_HOST\}:9444[\s\S]+handle \/deliver[\s\S]+reverse_proxy host-runner:3102/,
    );
    expect(stack.services.edge?.ports).toEqual(['127.0.0.1:8443:8080']);
    expect(JSON.stringify({ worker, containerRunner, hostRunner })).not.toMatch(
      /FALLBACK|compose-(?:container|host)-runner-token/i,
    );
  });

  it('routes only the declared UI4A surface and rejects internal or deferred routes by default', async () => {
    const stack = await renderedStack();
    const routing = edgeRoutingSource();
    const delivery = routing.indexOf('handle /deliver');
    const runner = routing.indexOf('reverse_proxy runner:3102');

    expect(delivery).toBeGreaterThan(0);
    expect(runner).toBeGreaterThan(delivery);
    expect(routing).not.toContain('handle_path /deliver*');
    expect(routing).toContain('@ui4aPublic');
    expect(routing).toContain('@ui4aAuthenticated');
    for (const path of [
      '/.well-known/ui4a.json',
      '/applications',
      '/api/entity',
      '/api/events',
      '/api/chat/history',
      '/api/chat/sessions',
      '/api/delegations',
      '/api/exec',
      '/api/exec-plan',
      '/api/chat',
      '/api/presence',
      '/_meta/.well-known/ui4a.json',
      '/_meta/api/entity',
      '/_meta/api/exec',
      '/api/presentation',
      '/api/presentation/sidecar',
    ]) {
      expect(routing, path).toContain(path);
    }
    expect(routing).not.toMatch(/\/api\/(?:internal|meta)\//);
    expect(routing).not.toMatch(/handle\s*\{\s*reverse_proxy web:3100/s);
    expect(routing).toMatch(/handle\s*\{\s*respond 404\s*\}/s);
    expect(stack.services.edge?.networks?.default?.aliases).toEqual([
      'ui4a.mothership.internal',
      'auth.ui4a.mothership.internal',
    ]);
  });

  it('keeps Keycloak Admin bootstrap on an un-published internal TLS listener', async () => {
    const stack = await renderedStack();
    const routing = edgeRoutingSource();
    const realmBootstrap = stack.services['realm-bootstrap'];
    const publicListener = routing.indexOf('@keycloakHost host');
    const internalListener = routing.indexOf('https://{$KEYCLOAK_HOST}:9443');
    const publicRouting = routing.slice(publicListener, internalListener);

    expect(realmBootstrap?.environment).toMatchObject({
      UI4A_KEYCLOAK_ADMIN_ORIGIN: 'https://auth.ui4a.mothership.internal:9443',
    });
    expect(publicListener).toBeGreaterThan(0);
    expect(internalListener).toBeGreaterThan(publicListener);
    expect(publicRouting).toContain('/realms/ui4a/.well-known/openid-configuration');
    expect(publicRouting).toContain('/realms/ui4a/protocol/openid-connect/token');
    expect(publicRouting).toContain('/realms/ui4a/protocol/openid-connect/auth/device');
    expect(publicRouting).toContain('/realms/ui4a/device/*');
    expect(publicRouting.match(/\/realms\/ui4a\/protocol\/openid-connect\/logout/g)).toHaveLength(
      2,
    );
    expect(publicRouting).not.toContain('/realms/master/');
    expect(publicRouting).not.toContain('/admin/');
    expect(routing.slice(internalListener)).toContain(
      '/realms/master/protocol/openid-connect/token',
    );
    expect(routing.slice(internalListener)).toContain('method GET POST PUT');
    expect(routing.slice(internalListener)).toContain('/admin/realms*');
    expect(stack.services.edge?.ports).toEqual(['127.0.0.1:8443:8080']);
    expect(stack.services.edge?.ports?.join(' ')).not.toContain('9443');
  });

  it('records the Compose TLS origin that operator settings must use', () => {
    const contract = requiredJson<StackContract & { runnerDelivery: Record<string, unknown> }>(
      contractPath,
    );

    expect(contract.runnerDelivery).toEqual({
      runnerId: 'compose-container-runner',
      route: '/deliver',
      workerOrigin: 'https://ui4a.mothership.internal:8443',
      workerCallbackOrigin: 'http://web:3100',
      workerWorkspaceVolume: 'runner-workspaces:/workspaces',
      edgeNetworkAlias: 'ui4a.mothership.internal',
      requiredServicePublicOrigin: 'https://ui4a.mothership.internal:8443',
    });
  });

  it('keeps the static Compose projection equivalent for Runner delivery wiring', () => {
    const compose = requiredSource('deploy/compose/compose.yaml');
    const routing = requiredSource('deploy/compose/edge-routing.caddy');

    expect(compose).toContain('UI4A_RUNNER_ID: compose-container-runner');
    expect(compose).toContain('UI4A_RUNNER_ID: compose-host-runner');
    expect(compose).toContain('UI4A_HOST_RUNNER_ORIGINS:');
    expect(compose).toContain('NODE_EXTRA_CA_CERTS: /var/lib/ui4a/ca/root-ca.crt');
    expect(compose).toContain('./edge-routing.caddy:/etc/caddy/Caddyfile:ro');
    expect(routing).toContain('handle /deliver {');
    expect(routing).toContain('reverse_proxy runner:3102');
    expect(compose).toContain('- ${UI4A_HOST:-ui4a.mothership.internal}');
    expect(compose).toContain('- ${KEYCLOAK_HOST:-auth.ui4a.mothership.internal}');
    expect(compose).toContain('UI4A_KEYCLOAK_ADMIN_ORIGIN:');
    expect(compose).toContain('UI4A_KEYCLOAK_PUBLIC_ORIGIN');
    expect(compose).toContain('UI4A_EDGE_HTTP_PORT');
    expect(compose).not.toMatch(/fetch\('http:\/\/127\.0\.0\.1:310[01]\/live'/);
    expect(compose).not.toMatch(/Bearer |runner-token|authorization/i);
  });

  it('keeps PostgreSQL, Temporal gRPC, and Keycloak database ports internal', async () => {
    const stack = await renderedStack();

    expect(publishedContainerPorts(stack.services.postgres!)).not.toContain(5432);
    expect(publishedContainerPorts(stack.services.temporal!)).not.toContain(7233);
    expect(publishedContainerPorts(stack.services.keycloak!)).not.toContain(5432);
  });

  it('uses read-only, non-root UI4A and one-shot containers with bounded writable paths', async () => {
    const stack = await renderedStack();

    for (const name of ['migration', 'realm-bootstrap', 'web', 'worker', 'runner', 'host-runner']) {
      const service = stack.services[name];
      expect(service?.read_only, name).toBe(true);
      expect(service?.user, name).toMatch(/^(?!0(?::0)?$)\d+(?::\d+)?$/);
      expect(service?.tmpfs, name).toEqual(
        expect.arrayContaining([expect.stringMatching(/^\/tmp:/)]),
      );
    }
  });

  it('renders each writable tmpfs as one absolute daemon mount specification', async () => {
    const expected = ['/tmp:rw,noexec,nosuid,size=64m'];
    const runtimeServices = [
      'migration',
      'realm-bootstrap',
      'pki-init',
      'web',
      'worker',
      'runner',
      'host-runner',
      'edge',
    ];
    const rendered = await renderedStack();
    for (const name of runtimeServices) {
      expect(rendered.services[name]?.tmpfs, `renderer:${name}`).toEqual(expected);
    }

    const staticConfig = JSON.parse(
      execFileSync(
        'docker',
        [
          'compose',
          '--project-name',
          'ui4a',
          '-f',
          'deploy/compose/compose.yaml',
          '--profile',
          'host-runner',
          'config',
          '--format',
          'json',
        ],
        { encoding: 'utf8' },
      ),
    ) as ComposeStack;
    for (const name of runtimeServices) {
      const tmpfs = staticConfig.services[name]?.tmpfs ?? [];
      expect(tmpfs, `daemon:${name}`).toEqual(expected);
      expect(tmpfs.every((mount) => mount.startsWith('/'))).toBe(true);
    }
    expect(staticConfig.services.postgres?.tmpfs).toEqual([
      '/var/run/ui4a/postgres-tls:rw,noexec,nosuid,size=1m,mode=0700',
    ]);
  });

  it('declares retained named volumes for data, backups, realm, CA, and Runner evidence', async () => {
    const contract = requiredJson<StackContract>(contractPath);
    const stack = await renderedStack();

    expect(Object.keys(stack.volumes).sort()).toEqual([...volumeNames].sort());
    expect(contract.volumes).toEqual(
      volumeNames.map((name) => ({ name, retainOnOrdinaryDown: true })),
    );
    expect(stack.services.postgres?.volumes).toContain('postgres-data:/var/lib/postgresql/data');
    expect(stack.services['realm-bootstrap']?.volumes).toEqual(
      expect.arrayContaining([
        'realm-data:/var/lib/ui4a/realm',
        'experiment-ca:/var/lib/ui4a/ca:ro',
        `${renderInput().realmFile}:/opt/ui4a/realm-import.json:ro`,
      ]),
    );
    expect(stack.services.runner?.volumes).toEqual(
      expect.arrayContaining(['runner-workspaces:/workspaces', 'runner-artifacts:/artifacts']),
    );
  });

  it('makes ordinary down non-destructive and isolates confirmed volume cleanup', () => {
    const { lifecycle } = requiredJson<StackContract>(contractPath);
    const down = lifecycle.down.join(' ');
    const clean = lifecycle.clean.command.join(' ');

    expect(lifecycle.up).toEqual([
      'docker',
      'compose',
      '-f',
      'deploy/compose/compose.yaml',
      'up',
      '-d',
      '--wait',
    ]);
    expect(down).toMatch(/^docker compose .+ down$/);
    expect(down).not.toMatch(/(?:^|\s)(?:-v|--volumes)(?:\s|$)/);
    expect(clean).toMatch(/(?:^|\s)--volumes(?:\s|$)/);
    expect(lifecycle.clean.confirmation).toBe('DELETE UI4A COMPOSE DATA');
    expect(lifecycle.clean.removesVolumes).toBe(true);
  });

  it('binds backup and isolated restore hooks to the existing direct recovery contracts', () => {
    const { lifecycle } = requiredJson<StackContract>(contractPath);

    expect(lifecycle.backupHook).toMatchObject({
      contractRef: 'deploy/postgres/backup-contract.json',
      privateArtifacts: ['runtime-config'],
    });
    expect(lifecycle.backupHook.command.join(' ')).toMatch(/backup.+compose/i);
    expect(lifecycle.restoreHook.isolatedTargetRequired).toBe(true);
    expect(lifecycle.restoreHook.command.join(' ')).toMatch(/restore.+isolated/i);
    expect(lifecycle.restoreHook.command.join(' ')).not.toMatch(/compose-main/i);
  });
});
