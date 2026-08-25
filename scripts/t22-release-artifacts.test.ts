import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = 'v0.1.0-experimental.1';
const releaseRoot = `release/${release}`;
const artifactPaths = [
  'release-manifest.json',
  'SHA256SUMS',
  'sbom/web.spdx.json',
  'sbom/worker.spdx.json',
  'sbom/runner.spdx.json',
  'vulnerability-summary.json',
  'RELEASE_NOTES.md',
  'acceptance-report.json',
  'runbook-inventory.json',
] as const;

const indexedArtifacts = {
  checksums: 'SHA256SUMS',
  vulnerabilitySummary: 'vulnerability-summary.json',
  releaseNotes: 'RELEASE_NOTES.md',
  acceptanceReport: 'acceptance-report.json',
  runbookInventory: 'runbook-inventory.json',
} as const;

const evidenceSets = [
  'build-provenance',
  'deployment-inventory',
  'identity',
  'runtime-matrix',
  'single-replica-replay',
  'backup-restore',
  'runbook-replay',
  'experimental-release',
] as const;

const runbookSections = [
  'target-preflight',
  'storage-decision',
  'image-build-transfer-digests',
  'namespace-istio-policy',
  'internal-ca-domains-certificates',
  'postgresql',
  'temporal',
  'keycloak-import-or-check',
  'database-migration',
  'web-worker',
  'kubernetes-agent-runtime',
  'host-runner',
  'dns-hosts-client-trust',
  'browser-cli-agent-authentication',
  'golden-story',
  'backup-restore',
  'upgrade-rollback',
  'health-logs-troubleshooting',
  'stop-uninstall-data-retention',
] as const;

interface ReleaseManifest {
  schemaVersion: number;
  release: string;
  channel: string;
  sourceGitSha: string;
  images: Record<
    'web' | 'worker' | 'runner',
    { immutableRef: string; digest: string; sbomRef: string }
  >;
  artifacts: Record<keyof typeof indexedArtifacts, string>;
  support: {
    internalExperiment: boolean;
    highAvailability: boolean;
    ga: boolean;
    productionReady: boolean;
    sla: boolean;
    lts: boolean;
  };
}

function absolute(relativePath: string): string {
  return resolve(repositoryRoot, releaseRoot, relativePath);
}

function source(relativePath: string): string {
  return readFileSync(absolute(relativePath), 'utf8');
}

function json<T>(relativePath: string): T {
  return JSON.parse(source(relativePath)) as T;
}

function requirePlannedArtifacts(): void {
  const missing = artifactPaths.filter((path) => !existsSync(absolute(path)));
  expect(missing, `missing ${release} release artifacts`).toEqual([]);
}

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

describe('T22 experimental release artifact bundle', () => {
  it('publishes one content-addressed inventory for the exact experimental release', () => {
    requirePlannedArtifacts();

    const manifest = json<ReleaseManifest>('release-manifest.json');
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      release,
      channel: 'experimental',
      support: {
        internalExperiment: true,
        highAvailability: false,
        ga: false,
        productionReady: false,
        sla: false,
        lts: false,
      },
      artifacts: indexedArtifacts,
    });
    expect(manifest.sourceGitSha).toBe('44a1fe37d9806434cc5d97a4ec0bc45197cce3ce');
    expect(Object.keys(manifest.images).sort()).toEqual(['runner', 'web', 'worker']);
    for (const [component, image] of Object.entries(manifest.images)) {
      expect(image.digest, component).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(image.immutableRef, component).toMatch(
        new RegExp(`^docker\\.io/ui4a/${component}@${image.digest}$`),
      );
      expect(image.sbomRef, component).toBe(`sbom/${component}.spdx.json`);
    }

    const checksumLines = source('SHA256SUMS').trim().split('\n');
    const checksums = new Map(
      checksumLines.map((line) => {
        const match = /^([0-9a-f]{64})  ([^/].*)$/.exec(line);
        expect(match, `invalid checksum line: ${line}`).not.toBeNull();
        return [match![2], match![1]];
      }),
    );
    const checksummedPaths = artifactPaths.filter((path) => path !== 'SHA256SUMS').sort();
    expect([...checksums.keys()].sort()).toEqual(checksummedPaths);
    for (const path of checksummedPaths) {
      expect(path).not.toMatch(/(?:^|\/)\.\.(?:\/|$)|^\//);
      expect(checksums.get(path), path).toBe(
        createHash('sha256')
          .update(readFileSync(absolute(path)))
          .digest('hex'),
      );
    }

    for (const component of ['web', 'worker', 'runner'] as const) {
      const sbom = json<{ spdxVersion?: string; packages?: unknown[] }>(
        `sbom/${component}.spdx.json`,
      );
      expect(sbom.spdxVersion, component).toBe('SPDX-2.3');
      expect(sbom.packages?.length, component).toBeGreaterThan(0);
    }
  });

  it('links E1-E8, all runbook steps, experimental limits, and no Secret material', () => {
    requirePlannedArtifacts();

    const acceptance = json<{
      release: string;
      evidenceSets: Array<{ id: string; status: string }>;
      deferred: Array<{ id: string; status: string }>;
      finalGate: {
        identityDataRecovery: { critical: number; high: number; status: string };
        vulnerability: {
          status: string;
          criticalMatches: number;
          highMatches: number;
          scanTool: string;
          dbVersion: string;
          acceptedFor: string;
        };
      };
    }>('acceptance-report.json');
    expect(acceptance.release).toBe(release);
    expect(acceptance.evidenceSets.map(({ id }) => id)).toEqual(evidenceSets);
    expect(acceptance.evidenceSets.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'build-provenance', status: 'partial-known-risk' },
      { id: 'deployment-inventory', status: 'passed' },
      { id: 'identity', status: 'passed' },
      { id: 'runtime-matrix', status: 'failed-honest' },
      { id: 'single-replica-replay', status: 'passed' },
      { id: 'backup-restore', status: 'passed' },
      { id: 'runbook-replay', status: 'passed' },
      { id: 'experimental-release', status: 'partial-known-risk' },
    ]);
    expect(acceptance.deferred).toEqual([
      { id: 'fault-injection', status: 'deferred' },
      { id: 'rollback', status: 'deferred' },
    ]);
    expect(acceptance.finalGate).toEqual({
      identityDataRecovery: { critical: 0, high: 0, status: 'passed' },
      vulnerability: {
        status: 'known-risk',
        criticalMatches: 50,
        highMatches: 241,
        scanTool: 'grype@0.117.0',
        dbVersion: 'v6.1.9',
        acceptedFor: 'internal-experiment-only',
      },
    });

    const vulnerability = json<{
      status: string;
      acceptedFor: string;
      criticalMatches: number;
      highMatches: number;
      scanTool: { name: string; version: string };
      database: { schemaVersion: string; valid: boolean };
    }>('vulnerability-summary.json');
    expect(vulnerability).toMatchObject({
      status: 'known-risk',
      acceptedFor: 'internal-experiment-only',
      criticalMatches: 50,
      highMatches: 241,
      scanTool: { name: 'grype', version: '0.117.0' },
      database: { schemaVersion: 'v6.1.9', valid: true },
    });

    const runbook = json<{
      release: string;
      sections: Array<{
        id: string;
        commandRef: string;
        expectedOutput: string;
        failureCriterion: string;
        recoveryAction: string;
      }>;
    }>('runbook-inventory.json');
    expect(runbook.release).toBe(release);
    expect(runbook.sections.map(({ id }) => id)).toEqual(runbookSections);
    for (const section of runbook.sections) {
      expect(section.commandRef.length, section.id).toBeGreaterThan(0);
      expect(section.expectedOutput.length, section.id).toBeGreaterThan(0);
      expect(section.failureCriterion.length, section.id).toBeGreaterThan(0);
      expect(section.recoveryAction.length, section.id).toBeGreaterThan(0);
    }

    const notes = source('RELEASE_NOTES.md').toLowerCase().replace(/\s+/g, ' ');
    for (const statement of [
      'internal experiment',
      'non-ha',
      'known limitations',
      'compatibility',
      'not ga',
      'no sla',
      'not lts',
      '50 critical',
      '241 high',
      'must not be used for production',
    ]) {
      expect(notes, `Release Notes must state ${statement}`).toContain(statement);
    }

    const forbiddenKeys = new Set([
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'password',
      'secret',
      'clientSecret',
      'privateKey',
      'cookie',
      'authorization',
      'tlsKey',
      'caPrivateKey',
    ]);
    for (const path of artifactPaths) {
      const text = source(path);
      expect(text, path).not.toMatch(
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]+=*|\bsk-[A-Za-z0-9_-]{8,}/,
      );
      if (path.endsWith('.json')) {
        expect(
          collectKeys(JSON.parse(text)).filter((key) => forbiddenKeys.has(key)),
          path,
        ).toEqual([]);
      }
    }
  });
});
