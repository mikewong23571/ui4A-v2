import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const runbookPath = resolve(root, 'docs/t22-production-runbook.md');
const inventoryPath = resolve(root, 'deploy/runbook/t22-runbook-inventory.json');

const chapterIds = [
  'cluster-preflight',
  'storage-decision',
  'images',
  'namespace-istio',
  'ca-domains-certificates',
  'postgresql',
  'temporal',
  'keycloak-realm',
  'database-migration',
  'web-worker',
  'kubernetes-runtime',
  'host-runner',
  'dns-client-ca',
  'authentication',
  'golden-story',
  'backup-restore',
  'upgrade-rollback',
  'health-troubleshooting',
  'stop-uninstall-retention',
] as const;

interface Inventory {
  schemaVersion: number;
  release: string;
  runbookRef: string;
  invariants: string[];
  externalReferences: Array<{ id: string; path: string; purpose: string }>;
  chapters: Array<{
    number: number;
    id: string;
    title: string;
    anchor: string;
    commands: Array<{
      id: string;
      command: string;
      expectedOutput: string;
      failureCriterion: string;
      recoveryAction: string;
    }>;
  }>;
}

function inventory(): Inventory {
  expect(existsSync(inventoryPath), 'planned runbook inventory is missing').toBe(true);
  return JSON.parse(readFileSync(inventoryPath, 'utf8')) as Inventory;
}

describe('T22 production-shaped runbook contract', () => {
  it('delivers the planned Markdown runbook and machine-readable inventory', () => {
    expect(existsSync(runbookPath), 'planned T22 runbook is missing').toBe(true);
    expect(existsSync(inventoryPath), 'planned runbook inventory is missing').toBe(true);
  });

  it('contains the exact FR14 19/19 ordered chapters', () => {
    const value = inventory();
    const markdown = readFileSync(runbookPath, 'utf8');

    expect(value).toMatchObject({
      schemaVersion: 1,
      release: 'v0.1.0-experimental.1',
      runbookRef: 'docs/t22-production-runbook.md',
    });
    expect(value.chapters.map(({ number }) => number)).toEqual(
      Array.from({ length: 19 }, (_, index) => index + 1),
    );
    expect(value.chapters.map(({ id }) => id)).toEqual(chapterIds);
    for (const chapter of value.chapters) {
      expect(chapter.title.length).toBeGreaterThan(0);
      expect(chapter.anchor).toBe(`#${chapter.number}-${chapter.id}`);
      expect(markdown).toContain(`## ${chapter.number}. ${chapter.title}`);
    }
  });

  it('gives every chapter exact commands, success, failure and recovery fields', () => {
    const value = inventory();

    for (const chapter of value.chapters) {
      expect(chapter.commands.length, chapter.id).toBeGreaterThan(0);
      for (const command of chapter.commands) {
        expect(command.id).toMatch(/^[a-z0-9][a-z0-9-]+$/);
        expect(command.command.trim().length).toBeGreaterThan(0);
        expect(command.expectedOutput.trim().length).toBeGreaterThan(0);
        expect(command.failureCriterion.trim().length).toBeGreaterThan(0);
        expect(command.recoveryAction.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('binds commands to repository-owned Compose, K8s, auth, runtime and recovery artifacts', () => {
    const serialized = JSON.stringify(inventory());
    const markdown = readFileSync(runbookPath, 'utf8');

    for (const required of [
      'pnpm compose:t22 up',
      'deploy/compose/compose.yaml',
      'deploy/helm/ui4a',
      'deploy/keycloak/realm-import.json',
      'scripts/t22-keycloak-realm-bootstrap.ts',
      'scripts/t22-k8s-recovery-observe-command.ts',
      'scripts/t22-k8s-recovery-command.ts',
      'scripts/t22-k8s-recovery-live.ts',
      'scripts/t22-k8s-replay-drill.ts',
      'apps/agent-runner/dist/main.js',
      'UI4A_RUNNER_ID',
      'UI4A_RUNNER_TOKEN',
    ]) {
      expect(`${serialized}\n${markdown}`).toContain(required);
    }
    expect(markdown).toContain('../mothership-setup/deploy/ui4a/README.md');
    expect(markdown).toContain('../mothership-setup/K8S-ISTIO-DEPLOY.md');
  });

  it('states destructive, identity, retention and experimental boundaries mechanically', () => {
    const value = inventory();
    const markdown = readFileSync(runbookPath, 'utf8');

    expect(value.invariants).toEqual(
      expect.arrayContaining([
        'no-prune',
        'no-force',
        'no-online-realm-reconcile',
        'retain-state',
        'single-replica-non-ha',
      ]),
    );
    for (const phrase of [
      'docker compose down` 不得带 `--volumes',
      '禁止 `helm upgrade --force`',
      '禁止 online realm reconciliation',
      'persistentVolumeReclaimPolicy: Retain',
      '单副本、非 HA',
      'v0.1.0-experimental.1',
    ]) {
      expect(markdown).toContain(phrase);
    }
    expect(markdown).not.toMatch(/production-ready|正式 SLA|长期支持/);
  });

  it('covers both stop-with-retention and separately confirmed destructive clean', () => {
    const chapter = inventory().chapters.find(({ id }) => id === 'stop-uninstall-retention');
    const commands = chapter?.commands.map(({ command }) => command).join('\n') ?? '';

    expect(commands).toContain('pnpm compose:t22 down');
    expect(commands).toContain('--confirm-destroy-volumes');
    expect(commands).toContain('helm uninstall');
    expect(commands).not.toContain('kubectl delete pvc');
    expect(commands).not.toContain('kubectl delete pv');
  });
});
