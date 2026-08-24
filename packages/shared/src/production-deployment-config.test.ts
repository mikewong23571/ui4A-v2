import { describe, expect, it } from 'vitest';

import {
  parseProductionDeploymentConfig,
  preflightProductionDeploymentFromEnvironment,
  productionDeploymentConfigFromHelmValues,
} from './production-deployment-config';

function validInput() {
  return {
    settings: {
      schemaVersion: 1,
      releaseStage: 'production',
      deploymentMode: 'compose',
      service: {
        publicOrigin: 'https://ui4a.mothership.internal',
      },
      auth: {
        mode: 'oidc',
        oidc: {
          issuer: 'https://auth.ui4a.mothership.internal/realms/ui4a',
          audience: 'ui4a-api',
          clientId: 'ui4a-web',
          clientSecretRef: 'oidc-client-secret',
          sessionSecretRef: 'oidc-session-secret',
          agentClientId: 'ui4a-agent',
          agentClientSecretRef: 'oidc-agent-client-secret',
          agentScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
          callbackUrl: 'https://ui4a.mothership.internal/api/auth/callback',
          scopes: [
            'openid',
            'profile',
            'ui4a:read',
            'ui4a:write',
            'ui4a:approve',
            'ui4a:policy:development',
          ],
        },
      },
      postgres: {
        host: 'postgres.ui4a.svc.cluster.local',
        port: 5432,
        database: 'ui4a',
        runtimeUser: 'ui4a_runtime',
        runtimePasswordRef: 'postgres-runtime-password',
        migrationUser: 'ui4a_migration',
        migrationPasswordRef: 'postgres-migration-password',
        pool: { min: 2, max: 20, idleTimeoutMs: 30_000 },
        connectTimeoutMs: 10_000,
        tls: {
          mode: 'verify-full',
          caCertificatePath: '/run/secrets/database-ca.crt',
        },
      },
      temporal: {
        address: 'temporal-frontend.ui4a.svc.cluster.local:7233',
        namespace: 'ui4a',
        taskQueue: 'ui4a-agent-runs',
        workerIdentity: 'ui4a-worker',
        connectTimeoutMs: 15_000,
        transport: { mode: 'istio' },
      },
      keycloak: {
        host: 'auth.ui4a.mothership.internal',
        realm: 'ui4a',
        database: 'keycloak',
        databasePasswordRef: 'keycloak-database-password',
        bootstrapAdminUser: 'ui4a-bootstrap-admin',
        bootstrapAdminPasswordRef: 'keycloak-bootstrap-admin-password',
        experimentHumanPasswordRef: 'keycloak-experiment-human-password',
      },
      tls: {
        ui4aHost: 'ui4a.mothership.internal',
        keycloakHost: 'auth.ui4a.mothership.internal',
        caCertificatePath: '/run/tls/ca.crt',
        ui4aCertificatePath: '/run/tls/ui4a/tls.crt',
        ui4aPrivateKeyPath: '/run/tls/ui4a/tls.key',
        keycloakCertificatePath: '/run/tls/keycloak/tls.crt',
        keycloakPrivateKeyPath: '/run/tls/keycloak/tls.key',
      },
      llm: {
        baseUrl: 'https://llm.mothership.internal/v1',
        model: 'ui4a-production-model',
        apiKeyRef: 'llm-api-key',
        requestTimeoutMs: 60_000,
      },
      runtime: {
        defaultProfiles: {
          coding: 'coding-k8s',
          writing: 'writing-host',
          authoring: 'authoring-k8s',
        },
        profiles: [
          {
            id: 'coding-k8s',
            specialization: 'coding',
            backend: 'kubernetes',
            image: 'registry.mothership.internal/ui4a/agent-runner@sha256:' + 'a'.repeat(64),
            workspaceRoot: '/workspace/coding',
            timeoutSeconds: 1_800,
            resources: { cpu: '2', memory: '4Gi' },
            networkPolicy: 'restricted',
            credentialRefs: ['codex-api-token'],
          },
          {
            id: 'writing-host',
            specialization: 'writing',
            backend: 'host',
            runnerId: 'trusted-writer-01',
            runnerTokenRef: 'host-runner-token',
            workspaceRoot: '/srv/ui4a/writing',
            timeoutSeconds: 900,
            resources: { cpu: '1', memory: '2Gi' },
            networkPolicy: 'restricted',
            credentialRefs: ['codex-api-token'],
          },
          {
            id: 'authoring-k8s',
            specialization: 'authoring',
            backend: 'kubernetes',
            image: 'registry.mothership.internal/ui4a/agent-runner@sha256:' + 'b'.repeat(64),
            workspaceRoot: '/workspace/authoring',
            timeoutSeconds: 900,
            resources: { cpu: '1', memory: '2Gi' },
            networkPolicy: 'restricted',
            credentialRefs: ['codex-api-token'],
          },
        ],
        repositories: [
          {
            ref: 'ui4a',
            root: '/srv/ui4a/repositories/ui4a',
            allowedPaths: ['apps/', 'packages/'],
          },
        ],
      },
    },
    secrets: {
      'postgres-runtime-password': '__test_only_postgres_runtime__',
      'postgres-migration-password': '__test_only_postgres_migration__',
      'keycloak-database-password': '__test_only_keycloak_database__',
      'keycloak-bootstrap-admin-password': '__test_only_keycloak_admin__',
      'keycloak-experiment-human-password': '__test_only_keycloak_experiment_human__',
      'oidc-client-secret': '__test_only_oidc_client__',
      'oidc-session-secret': '__test_only_oidc_session__',
      'oidc-agent-client-secret': '__test_only_oidc_agent_client__',
      'llm-api-key': '__test_only_llm_api_key__',
      'codex-api-token': '__test_only_codex_api_token__',
      'host-runner-token': '__test_only_host_runner_token__',
    },
  };
}

function expectInvalid(candidate: unknown, issue: RegExp) {
  expect(() => parseProductionDeploymentConfig(candidate)).toThrow(issue);
}

function deletePath(candidate: unknown, path: string) {
  const segments = path.split('.');
  const leaf = segments.pop();
  let current = candidate as Record<string, unknown>;
  for (const segment of segments) {
    current = current[segment] as Record<string, unknown>;
  }
  if (leaf) delete current[leaf];
}

describe('T22 production deployment config contract', () => {
  it('requires an independently referenced browser-session authentication secret', () => {
    const candidate = validInput();
    Object.assign(candidate.settings.auth.oidc, {
      sessionSecretRef: 'oidc-session-secret',
    });
    candidate.secrets['oidc-session-secret'] = '__test_only_oidc_session__';

    const parsed = parseProductionDeploymentConfig(candidate);

    expect(parsed.settings.auth.oidc.sessionSecretRef).toBe('oidc-session-secret');
    expect(JSON.stringify(parsed.settings)).not.toContain('__test_only_oidc_session__');
  });

  it('rejects a missing or client-credential-reused browser-session secret', () => {
    const missing = validInput();
    delete (missing.settings.auth.oidc as Partial<typeof missing.settings.auth.oidc>)
      .sessionSecretRef;
    expectInvalid(missing, /sessionSecretRef/);

    const reusedRef = validInput();
    Object.assign(reusedRef.settings.auth.oidc, {
      sessionSecretRef: reusedRef.settings.auth.oidc.clientSecretRef,
    });
    expectInvalid(reusedRef, /sessionSecretRef|must differ|reuse/i);

    const reusedMaterial = validInput();
    Object.assign(reusedMaterial.settings.auth.oidc, {
      sessionSecretRef: 'oidc-session-secret',
    });
    reusedMaterial.secrets['oidc-session-secret'] = (
      reusedMaterial.secrets as Record<string, string>
    )[reusedMaterial.settings.auth.oidc.clientSecretRef]!;
    expectInvalid(reusedMaterial, /sessionSecretRef|must differ|reuse/i);

    const reusedClientId = validInput();
    Object.assign(reusedClientId.settings.auth.oidc, {
      sessionSecretRef: 'oidc-session-secret',
    });
    reusedClientId.secrets['oidc-session-secret'] = reusedClientId.settings.auth.oidc.clientId;
    expectInvalid(reusedClientId, /sessionSecretRef|must differ|reuse/i);
  });

  it.each(['compose', 'kubernetes'])('accepts the %s deployment mode', (deploymentMode) => {
    const candidate = validInput();
    candidate.settings.deploymentMode = deploymentMode;

    const parsed = parseProductionDeploymentConfig(candidate);

    expect(parsed.settings.deploymentMode).toBe(deploymentMode);
    expect(parsed.settings.auth.mode).toBe('oidc');
    expect(parsed.settings.runtime.defaultProfiles).toEqual({
      coding: 'coding-k8s',
      writing: 'writing-host',
      authoring: 'authoring-k8s',
    });
  });

  it('normalizes equivalent Compose-env and Helm-values mappings to one contract', () => {
    const composeMappedCanonicalInput = validInput();
    const helmValuesMappedCanonicalInput = structuredClone(composeMappedCanonicalInput);

    expect(parseProductionDeploymentConfig(composeMappedCanonicalInput)).toEqual(
      parseProductionDeploymentConfig(helmValuesMappedCanonicalInput),
    );
  });

  it('shares one bounded Agent OIDC client contract across Compose and Helm', () => {
    const canonical = validInput();
    type AgentOidcFields = {
      agentClientId: string;
      agentClientSecretRef: string;
      agentScopes: string[];
    };
    const oidc = canonical.settings.auth.oidc as typeof canonical.settings.auth.oidc &
      AgentOidcFields;
    Object.assign(oidc, {
      audience: 'ui4a-api',
      agentClientId: 'ui4a-agent',
      agentClientSecretRef: 'oidc-agent-client-secret',
      agentScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
    });
    Object.assign(canonical.secrets, {
      'oidc-agent-client-secret': '__test_only_oidc_agent_client__',
    });

    const fromEnvironment = preflightProductionDeploymentFromEnvironment({
      UI4A_DEPLOYMENT_PROFILE: 'production',
      UI4A_DEPLOYMENT_SETTINGS_JSON: JSON.stringify(canonical.settings),
      UI4A_DEPLOYMENT_SECRETS_JSON: JSON.stringify(canonical.secrets),
    });
    const fromHelm = productionDeploymentConfigFromHelmValues({
      ui4a: { deploymentConfig: canonical },
    });

    expect(fromEnvironment).toEqual(fromHelm);
    expect(fromEnvironment?.settings.auth.oidc).toMatchObject({
      agentClientId: 'ui4a-agent',
      agentClientSecretRef: 'oidc-agent-client-secret',
      agentScopes: ['ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
    });
    expect(oidc.agentClientId).not.toBe(oidc.clientId);
    expect(oidc.agentClientId).not.toBe(oidc.audience);
    expect(oidc.agentClientSecretRef).not.toBe(oidc.clientSecretRef);
    expect(oidc.agentClientSecretRef).not.toBe(oidc.sessionSecretRef);
    expect(canonical.secrets['oidc-agent-client-secret']).not.toBe(
      canonical.secrets['oidc-client-secret'],
    );
    expect(canonical.secrets['oidc-agent-client-secret']).not.toBe(
      canonical.secrets['oidc-session-secret'],
    );

    for (const invalidScopes of [
      [],
      ['ui4a:read', 'ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
      ['ui4a:read', 'ui4a:write', 'openid', 'ui4a:policy:development'],
      ['ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
      ['ui4a:read', 'ui4a:write'],
      ['ui4a:read', 'ui4a:policy:development'],
      ['ui4a:write', 'ui4a:policy:development'],
      ['ui4a:read', 'ui4a:write', 'ui4a:policy:unknown'],
    ]) {
      const invalid = structuredClone(canonical);
      Object.assign(invalid.settings.auth.oidc, { agentScopes: invalidScopes });
      expectInvalid(invalid, /agentScopes|scope|duplicate|approve|openid|policy/i);
    }
  });

  it('fixes the experimental realm and three client identities to the shared realm artifact', () => {
    const fixed = parseProductionDeploymentConfig(validInput());

    expect(fixed.settings.keycloak.realm).toBe('ui4a');
    expect(fixed.settings.auth.oidc).toMatchObject({
      clientId: 'ui4a-web',
      agentClientId: 'ui4a-agent',
      audience: 'ui4a-api',
    });

    for (const [path, mutate] of [
      [
        'settings.keycloak.realm',
        (candidate: ReturnType<typeof validInput>) => (candidate.settings.keycloak.realm = 'other'),
      ],
      [
        'settings.auth.oidc.clientId',
        (candidate: ReturnType<typeof validInput>) =>
          (candidate.settings.auth.oidc.clientId = 'other-web'),
      ],
      [
        'settings.auth.oidc.audience',
        (candidate: ReturnType<typeof validInput>) =>
          (candidate.settings.auth.oidc.audience = 'other-api'),
      ],
    ] as const) {
      const candidate = validInput();
      mutate(candidate);
      if (path === 'settings.keycloak.realm') {
        candidate.settings.auth.oidc.issuer = 'https://auth.ui4a.mothership.internal/realms/other';
      }
      expectInvalid(candidate, new RegExp(path.replaceAll('.', '\\.')));
    }
  });

  it('requires browser scopes that the fixed realm can issue for the Golden path', () => {
    for (const invalidScopes of [
      ['openid', 'ui4a:read', 'ui4a:write', 'ui4a:policy:development'],
      ['openid', 'ui4a:read', 'ui4a:approve', 'ui4a:policy:development'],
      ['openid', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:development'],
      ['openid', 'ui4a:read', 'ui4a:write', 'ui4a:approve'],
      ['openid', 'ui4a:read', 'ui4a:write', 'ui4a:approve', 'ui4a:policy:unknown'],
    ]) {
      const candidate = validInput();
      candidate.settings.auth.oidc.scopes = invalidScopes;
      expectInvalid(candidate, /auth\.oidc\.scopes|permission|policy/i);
    }
  });

  it('requires an explicit configured Secret ref for the imported experimental human', () => {
    const missingField = validInput();
    delete (missingField.settings.keycloak as { experimentHumanPasswordRef?: string })
      .experimentHumanPasswordRef;
    expectInvalid(missingField, /settings\.keycloak\.experimentHumanPasswordRef/);

    const missingSecret = validInput();
    delete (missingSecret.secrets as Record<string, string>)['keycloak-experiment-human-password'];
    expectInvalid(missingSecret, /settings\.keycloak\.experimentHumanPasswordRef/);
  });

  it('keeps Secret material structurally separate from ordinary settings', () => {
    const parsed = parseProductionDeploymentConfig(validInput());
    const serializedSettings = JSON.stringify(parsed.settings);

    for (const secret of Object.values(parsed.secrets)) {
      expect(serializedSettings).not.toContain(secret);
    }

    const inlineSecret = validInput();
    Object.assign(inlineSecret.settings.llm, { apiKey: '__must_not_be_inline__' });
    expectInvalid(inlineSecret, /llm\.apiKey|unknown|secret/i);
  });

  it.each(['auth', 'postgres', 'temporal', 'keycloak', 'tls', 'llm', 'runtime'])(
    'rejects a missing required settings section: %s',
    (section) => {
      const candidate = validInput();
      delete (candidate.settings as Record<string, unknown>)[section];
      expectInvalid(candidate, new RegExp(`settings\\.${section}`));
    },
  );

  it('rejects a missing Secret collection', () => {
    const candidate = validInput();
    delete (candidate as Partial<ReturnType<typeof validInput>>).secrets;
    expectInvalid(candidate, /secrets/);
  });

  it.each([
    'settings.auth.oidc.audience',
    'settings.postgres.runtimePasswordRef',
    'settings.temporal.taskQueue',
    'settings.keycloak.bootstrapAdminPasswordRef',
    'settings.tls.ui4aPrivateKeyPath',
    'settings.llm.model',
    'settings.runtime.defaultProfiles.authoring',
  ])('rejects a missing required field: %s', (path) => {
    const candidate = validInput();
    deletePath(candidate, path);
    expectInvalid(candidate, new RegExp(path.replaceAll('.', '\\.')));
  });

  it.each([
    ['service.publicOrigin', 'not-a-url'],
    ['service.publicOrigin', 'http://ui4a.mothership.internal'],
    ['auth.oidc.issuer', 'https://wrong-issuer.internal/realms/ui4a'],
    ['auth.oidc.issuer', 'http://auth.ui4a.mothership.internal/realms/ui4a'],
    ['auth.oidc.callbackUrl', 'https://wrong-ui.internal/api/auth/callback'],
    ['llm.baseUrl', 'localhost:9000/v1'],
    ['llm.baseUrl', 'http://llm.mothership.internal/v1'],
  ])('rejects an invalid or inconsistent production URL at %s', (path, value) => {
    const candidate = validInput();
    const [section, field, nestedField] = path.split('.');
    const sectionValue = candidate.settings[section as keyof typeof candidate.settings] as Record<
      string,
      unknown
    >;
    if (nestedField) {
      (sectionValue[field] as Record<string, unknown>)[nestedField] = value;
    } else {
      sectionValue[field] = value;
    }

    expectInvalid(candidate, new RegExp(path.replaceAll('.', '\\.')));
  });

  it.each([
    [
      'postgres host',
      (candidate: ReturnType<typeof validInput>) =>
        (candidate.settings.postgres.host = 'localhost'),
    ],
    [
      'Temporal address',
      (candidate: ReturnType<typeof validInput>) =>
        (candidate.settings.temporal.address = '127.0.0.1:7233'),
    ],
    [
      'default Temporal namespace',
      (candidate: ReturnType<typeof validInput>) =>
        (candidate.settings.temporal.namespace = 'default'),
    ],
    [
      'wildcard OIDC audience',
      (candidate: ReturnType<typeof validInput>) => (candidate.settings.auth.oidc.audience = '*'),
    ],
    [
      'localhost Keycloak host',
      (candidate: ReturnType<typeof validInput>) =>
        (candidate.settings.keycloak.host = 'localhost'),
    ],
    [
      'TLS host mismatch',
      (candidate: ReturnType<typeof validInput>) =>
        (candidate.settings.tls.keycloakHost = 'other-auth.internal'),
    ],
    [
      'disabled PostgreSQL TLS',
      (candidate: ReturnType<typeof validInput>) =>
        (candidate.settings.postgres.tls.mode = 'disable'),
    ],
    [
      'unbounded database pool',
      (candidate: ReturnType<typeof validInput>) => (candidate.settings.postgres.pool.max = 0),
    ],
    [
      'floating Runtime image',
      (candidate: ReturnType<typeof validInput>) =>
        (candidate.settings.runtime.profiles[0].image = 'ui4a/agent-runner:latest'),
    ],
    [
      'root workspace',
      (candidate: ReturnType<typeof validInput>) =>
        (candidate.settings.runtime.profiles[0].workspaceRoot = '/'),
    ],
  ])('rejects a dangerous production default: %s', (_case, mutate) => {
    const candidate = validInput();
    mutate(candidate);
    expectInvalid(candidate, /production|localhost|temporal|tls|pool|image|workspace/i);
  });

  it('rejects demo identity and every implicit localhost fallback in production', () => {
    const demoIdentity = validInput();
    demoIdentity.settings.auth.mode = 'demo';
    expectInvalid(demoIdentity, /auth\.mode|demo/i);

    const localFallback = validInput();
    localFallback.settings.postgres.host = 'localhost';
    localFallback.settings.temporal.address = 'localhost:7233';
    localFallback.settings.llm.baseUrl = 'http://localhost:9000/v1';
    expectInvalid(localFallback, /localhost|production/i);
  });

  it.each([
    [
      'empty Secret',
      (candidate: ReturnType<typeof validInput>) => (candidate.secrets['llm-api-key'] = '  '),
    ],
    [
      'missing Secret ref',
      (candidate: ReturnType<typeof validInput>) =>
        delete (candidate.secrets as Record<string, string>)['oidc-client-secret'],
    ],
  ])('rejects %s without disclosing Secret material', (_case, mutate) => {
    const candidate = validInput();
    const canaries = Object.values(candidate.secrets).filter((value) => value.trim().length > 0);
    mutate(candidate);

    try {
      parseProductionDeploymentConfig(candidate);
      throw new Error('expected invalid production config');
    } catch (error) {
      expect(String(error)).toMatch(/secret|ref|empty|required/i);
      for (const canary of canaries) expect(String(error)).not.toContain(canary);
    }
  });

  it('rejects request-controlled Runtime/Profile overrides and wider-backend fallback', () => {
    const requestOverride = validInput();
    Object.assign(requestOverride.settings.runtime, {
      requestOverrides: { backend: 'host', image: 'attacker/image:latest', cwd: '/' },
    });
    expectInvalid(requestOverride, /requestOverrides|unknown|override/i);

    const profileOverride = validInput();
    Object.assign(profileOverride.settings.runtime.profiles[0], {
      allowRequestOverrides: true,
      fallbackBackend: 'host',
    });
    expectInvalid(profileOverride, /allowRequestOverrides|fallbackBackend|unknown|override/i);
  });

  it('requires each specialization to resolve to one sealed, server-owned profile', () => {
    const candidate = validInput();
    candidate.settings.runtime.defaultProfiles.coding = 'request-selected';

    expectInvalid(candidate, /runtime\.defaultProfiles\.coding|profile|request-selected/i);
  });
});

describe('T22 canonical deployment mappings', () => {
  it('maps Compose environment JSON and Helm values to the same canonical config', () => {
    const canonical = validInput();
    const fromEnvironment = preflightProductionDeploymentFromEnvironment({
      UI4A_DEPLOYMENT_PROFILE: 'production',
      UI4A_DEPLOYMENT_SETTINGS_JSON: JSON.stringify(canonical.settings),
      UI4A_DEPLOYMENT_SECRETS_JSON: JSON.stringify(canonical.secrets),
    });
    const fromHelm = productionDeploymentConfigFromHelmValues({
      ui4a: { deploymentConfig: canonical },
    });

    expect(fromEnvironment).toEqual(fromHelm);
  });

  it('supports mounted settings and Secret files without disclosing Secret file contents', () => {
    const canonical = validInput();
    const files: Record<string, string> = {
      '/run/ui4a/settings.json': JSON.stringify(canonical.settings),
      '/run/ui4a/secrets.json': JSON.stringify(canonical.secrets),
    };
    const parsed = preflightProductionDeploymentFromEnvironment(
      {
        UI4A_DEPLOYMENT_PROFILE: 'production',
        UI4A_DEPLOYMENT_SETTINGS_FILE: '/run/ui4a/settings.json',
        UI4A_DEPLOYMENT_SECRETS_FILE: '/run/ui4a/secrets.json',
      },
      (path) => {
        const content = files[path];
        if (content === undefined) throw new Error('missing');
        return content;
      },
    );

    expect(parsed?.settings).toEqual(parseProductionDeploymentConfig(canonical).settings);
  });

  it('does not infer production from NODE_ENV and rejects ambiguous production sources', () => {
    expect(
      preflightProductionDeploymentFromEnvironment({ NODE_ENV: 'production' }),
    ).toBeUndefined();

    expect(() =>
      preflightProductionDeploymentFromEnvironment({
        UI4A_DEPLOYMENT_PROFILE: 'production',
        UI4A_DEPLOYMENT_SETTINGS_JSON: '{}',
        UI4A_DEPLOYMENT_SETTINGS_FILE: '/run/ui4a/settings.json',
        UI4A_DEPLOYMENT_SECRETS_JSON: '{}',
      }),
    ).toThrow(/exactly one|settings/i);
  });
});
