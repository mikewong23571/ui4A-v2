import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

function source(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) throw new Error(`missing T22 runtime edge artifact: ${path}`);
  return readFileSync(absolutePath, 'utf8');
}

describe('T22 Kubernetes Runner production composition', () => {
  it('exports a server-owned one-shot adapter for Kubernetes Job delivery', async () => {
    const production = (await import(
      pathToFileURL(resolve(repositoryRoot, 'apps/agent-runner/src/production.ts')).href
    )) as { createProductionRunnerOneshotAdapter?: unknown };

    expect(production.createProductionRunnerOneshotAdapter).toBeTypeOf('function');
  });

  it('wires the production Kubernetes one-shot adapter into the executable Runner entry', () => {
    const main = source('apps/agent-runner/src/main.ts');

    expect(main).toContain('createProductionRunnerOneshotAdapter');
    expect(main).toMatch(/command === ['"]oneshot['"][\s\S]+createProductionRunnerOneshotAdapter/);
  });

  it('keeps the idle Kubernetes footprint free of a non-delivering Runner daemon', () => {
    const production = source('apps/agent-runner/src/production.ts');
    const transport = source(
      'apps/worker/src/runtime-backends/kubernetes/runtime-transport-manifests.ts',
    );
    const deployments = source('deploy/helm/ui4a/templates/deployments.yaml');
    const services = source('deploy/helm/ui4a/templates/services.yaml');
    const renderer = source('deploy/helm/ui4a/render.ts');

    expect(production).toMatch(/deploymentMode === 'kubernetes'[\s\S]+deliveryAvailable = false/);
    expect(transport).toMatch(/command: \['node', 'dist\/main\.js', 'oneshot'\]/);
    expect(deployments).not.toMatch(
      /kind:\s*Deployment[\s\S]+name:\s*runner[\s\S]+command:\s*\[node, dist\/main\.js, daemon\]/,
    );
    expect(services).not.toMatch(/kind:\s*Service[\s\S]+name:\s*runner/);
    expect(renderer).not.toMatch(/deployment\(\s*namespace,\s*'runner'/);
    expect(renderer).not.toMatch(/service\(namespace, 'runner', 3102\)/);
  });
});

describe('T22 opaque internal callback and Istio JWT interoperation', () => {
  it('keeps opaque callback credentials out of the JWT Authorization header', () => {
    const callbackSources = [
      'apps/worker/src/agents/coding/adapter-results.ts',
      'apps/worker/src/agents/writing/adapter.ts',
      'apps/worker/src/agents/authoring/adapter.ts',
      'apps/web/src/app/api/internal/agent-run-callback/route.ts',
    ].map(source);

    for (const callbackSource of callbackSources) {
      expect(callbackSource).toContain('x-ui4a-capability-token');
      expect(callbackSource).not.toMatch(/authorization\s*:\s*`Bearer\s+\$\{(?:input\.)?token\}`/);
    }
  });

  it('keeps internal callback paths off the Gateway while allowing the Worker identity', () => {
    const istio = source('deploy/helm/ui4a/templates/istio.yaml');

    expect(istio).not.toMatch(/exact:\s*\/api\/internal\/capability-callback/);
    expect(istio).toMatch(/exact:\s*\/api\/internal\/agent-run-callback/);
    expect(istio).not.toMatch(/prefix:\s*\/api\/internal\//);
    expect(istio).toMatch(/directResponse:\s*\{\s*status:\s*404\s*\}/);
    expect(istio).toMatch(/principals:[\s\S]+serviceAccounts\.worker/);
    expect(istio).not.toMatch(/fromHeaders:[\s\S]+x-ui4a-capability-token/);
  });
});
