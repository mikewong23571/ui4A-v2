import { describe, expect, it } from 'vitest';

import {
  contractPath,
  coreServices,
  dependency,
  digest,
  initServices,
  loadRenderer,
  longRunningServices,
  plannedNetworks,
  plannedTopLevelNetworks,
  plannedVolumes,
  renderInput,
  renderedStack,
  rendererPath,
  repositoryRoot,
  requiredJson,
  requiredSource,
  staticRenderInput,
  volumeNames,
} from './t22-compose-test-helpers';

describe('T22 Docker Compose all-in-one contract', () => {
  it('declares the experimental single-replica topology and exact service inventory', () => {
    const contract = requiredJson<StackContract>(contractPath);

    expect(contract.schemaVersion).toBe(1);
    expect(contract.topology).toEqual({
      replicas: 1,
      highAvailability: false,
      keycloak: {
        instances: 1,
        realms: ['ui4a'],
        clients: ['ui4a-web', 'ui4a-agent', 'ui4a-api'],
      },
    });
    expect([...contract.services].sort()).toEqual([...coreServices].sort());
  });

  it('reuses canonical settings, OCI, PostgreSQL, Temporal, Keycloak, and backup semantics', () => {
    const contract = requiredJson<StackContract>(contractPath);

    expect(contract.references).toEqual({
      composeFile: 'deploy/compose/compose.yaml',
      renderer: 'deploy/compose/render-stack.ts',
      productionConfig: 'packages/shared/src/production-deployment-config.ts',
      imageContract: 'deploy/oci/image-contract.json',
      postgresStateful: 'deploy/postgres/stateful-contract.json',
      postgresBindings: 'deploy/postgres/deployment-bindings.json',
      postgresBackup: 'deploy/postgres/backup-contract.json',
      temporal: 'deploy/temporal/production-contract.json',
      keycloakRealm: 'deploy/keycloak/realm-import.json',
      keycloakBootstrap: 'deploy/keycloak/realm-bootstrap.ts',
      operatorInputs: 'scripts/t22/compose/t22-compose-inputs.ts',
      storyAcceptance: 'deploy/compose/acceptance-contract.json',
    });
    for (const path of Object.values(contract.references)) requiredSource(path);
  });

  it('renders every core and optional Host Runner service without hidden replicas', async () => {
    const stack = await renderedStack();

    expect(stack.name).toBe('ui4a');
    expect(Object.keys(stack.services).sort()).toEqual([...coreServices].sort());
    expect(stack.services['host-runner']?.profiles).toEqual(['host-runner']);
    expect(stack['x-ui4a-contract']).toEqual({
      schemaVersion: 1,
      replicas: 1,
      highAvailability: false,
      realmLifecycle: 'import-or-check-and-skip',
    });
  });

  it('pins every service image by digest and uses the IfNotPresent-equivalent pull policy', async () => {
    const stack = await renderedStack();

    for (const [name, service] of Object.entries(stack.services)) {
      expect(service.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
      expect(service.image, name).not.toMatch(/:latest(?:@|$)/);
      expect(service.pull_policy, name).toBe('missing');
    }
  });

  it('rejects mutable image tags before rendering an executable stack', async () => {
    const renderer = await loadRenderer();
    const input = renderInput();
    input.images.web = 'nexus.internal/ui4a/web:latest';

    expect(() => renderer.renderComposeStack(input)).toThrow(/image|digest|sha256/i);
  });

  it('renders deterministically for idempotent restart from the same sealed inputs', async () => {
    const renderer = await loadRenderer();
    const input = renderInput();

    expect(renderer.renderComposeStack(input)).toEqual(
      renderer.renderComposeStack(structuredClone(input)),
    );
  });

  it('starts stateful dependencies, schema jobs, realm check, and migration in a safe order', async () => {
    const stack = await renderedStack();

    expect(dependency(stack, 'postgres-bootstrap', 'postgres')).toBe('service_healthy');
    expect(dependency(stack, 'temporal-schema', 'postgres-bootstrap')).toBe(
      'service_completed_successfully',
    );
    expect(dependency(stack, 'temporal', 'temporal-schema')).toBe('service_completed_successfully');
    expect(dependency(stack, 'temporal-namespace', 'temporal')).toBe('service_healthy');
    expect(dependency(stack, 'keycloak', 'postgres-bootstrap')).toBe(
      'service_completed_successfully',
    );
    expect(dependency(stack, 'realm-bootstrap', 'keycloak')).toBe('service_healthy');
    expect(dependency(stack, 'realm-bootstrap', 'edge')).toBe('service_healthy');
    expect(dependency(stack, 'edge', 'pki-init')).toBe('service_completed_successfully');
    expect(dependency(stack, 'edge', 'web')).toBeUndefined();
    expect(dependency(stack, 'edge', 'keycloak')).toBeUndefined();
    expect(dependency(stack, 'edge', 'runner')).toBeUndefined();
    expect(dependency(stack, 'migration', 'postgres-bootstrap')).toBe(
      'service_completed_successfully',
    );
    for (const service of ['web', 'worker']) {
      expect(dependency(stack, service, 'migration')).toBe('service_completed_successfully');
      expect(dependency(stack, service, 'realm-bootstrap')).toBe('service_completed_successfully');
      expect(dependency(stack, service, 'temporal-namespace')).toBe(
        'service_completed_successfully',
      );
    }
  });

  it('gives every long-running dependency a bounded healthcheck and restart policy', async () => {
    const stack = await renderedStack();

    for (const name of longRunningServices) {
      const service = stack.services[name];
      expect(service?.restart, name).toBe('unless-stopped');
      expect(service?.healthcheck?.test.length, name).toBeGreaterThan(0);
      expect(service?.healthcheck?.interval, name).toMatch(/^\d+s$/);
      expect(service?.healthcheck?.timeout, name).toMatch(/^\d+s$/);
      expect(service?.healthcheck?.retries, name).toBeGreaterThan(0);
    }
    for (const name of initServices) expect(stack.services[name]?.restart, name).toBe('no');
  });

  it('uses dependency-aware readiness for Web and Worker without conflating process liveness', async () => {
    const stack = await renderedStack();

    for (const name of ['web', 'worker'] as const) {
      const probe = stack.services[name]?.healthcheck?.test.join(' ') ?? '';
      expect(probe, name).toContain(`/ready`);
      expect(probe, name).not.toContain(`/live`);
    }
    // Runner readiness remains owned by its deployment audit and is intentionally unchanged here.
    expect(stack.services.runner?.healthcheck?.test.join(' ')).toContain('/live');
  });
});
