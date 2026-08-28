import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('T22 disposable probe source governance', () => {
  it('keeps fixed credentials and repository writes out of probe sources', () => {
    const probes = [
      source('scripts/t22/keycloak/t22-keycloak-probe.ts'),
      source('scripts/t22/t22-runtime-probe.ts'),
      source('scripts/t22/t22-temporal-probe.ts'),
    ].join('\n');

    expect(probes).not.toMatch(
      /probe-admin-password|probe-human-password|probe-agent-secret|probe-actor-password/,
    );
    expect(probes).not.toMatch(/writeFile|appendFile|rmSync|unlinkSync|truncateSync/);
    expect(probes).not.toMatch(/child_process|execSync|spawnSync/);
  });

  it('requires explicit live gates and cleans disposable Keycloak resources', () => {
    const keycloak = source('scripts/t22/keycloak/t22-keycloak-probe.ts');
    const runtime = source('scripts/t22/t22-runtime-probe.ts');

    expect(keycloak).toContain('KEYCLOAK_PROBE_ADMIN_PASSWORD is required');
    expect(keycloak).toContain("'/realms/' + realm, { method: 'DELETE' }");
    expect(keycloak).toContain('await browser.close()');
    expect(keycloak).toContain('server.close');
    expect(runtime).toContain("process.env.T22_K8S_JOB_PROBE !== 'passed'");
    expect(runtime).toContain('requestForbidden');
    expect(runtime).toContain("server.listen(0, '127.0.0.1'");
  });

  it('keeps the Temporal probe configurable and its workflow deterministic', () => {
    const temporal = source('scripts/t22/t22-temporal-probe.ts');
    const workflow = source('apps/worker/src/t22-temporal-probe-workflows.ts');

    expect(temporal).toContain("process.env.TEMPORAL_NAMESPACE ?? 'ui4a-probe'");
    expect(temporal).toContain("process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:17233'");
    expect(workflow).toMatch(/^import \{ sleep \} from '@temporalio\/workflow';/);
    expect(workflow).not.toMatch(/node:|process\.|fetch\(|Date\.|Math\.random|setTimeout/);
  });

  it('does not register probe workflows or scripts in production entry points', () => {
    for (const path of [
      'apps/worker/src/main.ts',
      'apps/worker/src/workflows.ts',
      'apps/worker/src/activities.ts',
      'apps/web/src/engine/service.ts',
      'package.json',
    ]) {
      const production = source(path);
      expect(production, path).not.toMatch(/t22-(keycloak|runtime|temporal)-probe/);
    }
  });
});
