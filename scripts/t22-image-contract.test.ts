import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const imageFiles = {
  web: 'apps/web/Dockerfile',
  worker: 'apps/worker/Dockerfile',
  runner: 'apps/agent-runner/Dockerfile',
} as const;

function requiredSource(path: string): string {
  const absolutePath = resolve(repositoryRoot, path);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing T22 OCI contract artifact: ${path}`);
  }
  return readFileSync(absolutePath, 'utf8');
}

function packageJson(path: string): { scripts?: Record<string, string> } {
  return JSON.parse(requiredSource(path)) as { scripts?: Record<string, string> };
}

describe('T22 production OCI image contract', () => {
  it('gives Worker a compiled production build and start path', () => {
    const scripts = packageJson('apps/worker/package.json').scripts ?? {};

    expect(scripts.build, 'apps/worker must compile a production artifact').toBeTruthy();
    expect(scripts.start, 'apps/worker must start the compiled artifact').toMatch(
      /^node\s+.+dist\/.+\.js$/,
    );
    expect(`${scripts.build ?? ''}\n${scripts.start ?? ''}`).not.toMatch(/\btsx\b|src\/main\.ts/);
  });

  it.each(Object.entries(imageFiles))(
    'defines a pinned, multi-stage, non-root %s image with health and provenance',
    (_name, path) => {
      const dockerfile = requiredSource(path);

      expect(dockerfile).toMatch(/^ARG NODE_VERSION=24(?:\.\d+){0,2}$/m);
      expect(dockerfile).toMatch(/^ARG PNPM_VERSION=10\.32\.1$/m);
      expect(dockerfile.match(/^FROM\s+.+$/gm)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(dockerfile).toMatch(/^FROM\s+.+\s+AS\s+runtime$/im);
      expect(dockerfile).toMatch(/^USER\s+(?!root\b)\S+/m);
      expect(dockerfile).toMatch(/^HEALTHCHECK\s+/m);
      expect(dockerfile).toMatch(/^ARG UI4A_VERSION$/m);
      expect(dockerfile).toMatch(/^ARG UI4A_GIT_SHA$/m);
      expect(dockerfile).toMatch(/^ARG UI4A_BUILD_DATE$/m);
      expect(dockerfile).toContain('org.opencontainers.image.version');
      expect(dockerfile).toContain('org.opencontainers.image.revision');
      expect(dockerfile).toContain('org.opencontainers.image.created');
      expect(dockerfile).toContain('io.ui4a.release.channel="experimental"');
    },
  );

  it('keeps secret-bearing and development artifacts outside the build context', () => {
    const ignored = requiredSource('.dockerignore');

    for (const pattern of [
      '.env*',
      '**/.env*',
      '**/.next*',
      '**/node_modules',
      '**/coverage',
      '**/playwright-report',
      '**/test-results',
      '**/*.db',
      '**/*.sqlite*',
      '.codex',
      '**/.codex/**',
      '**/*.key',
      '**/secrets/**',
    ]) {
      expect(ignored, `.dockerignore must contain ${pattern}`).toMatch(
        new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
      );
    }
  });

  it('declares one shared runtime, health, writable-path and release metadata contract', () => {
    const contract = JSON.parse(requiredSource('deploy/oci/image-contract.json')) as {
      schemaVersion: number;
      release: {
        version: string;
        tag: string;
        channel: string;
        support: Record<string, boolean>;
        buildArgs: string[];
        labels: string[];
      };
      images: Record<
        string,
        {
          dockerfile: string;
          entrypoint: string[];
          health: { command: string[]; endpoint?: string; versionEndpoint?: string };
          runAsNonRoot: boolean;
          readOnlyRootFilesystem: boolean;
          writablePaths: string[];
        }
      >;
    };

    expect(contract.schemaVersion).toBe(1);
    expect(contract.release).toEqual(
      expect.objectContaining({
        version: '0.1.0-experimental.1',
        tag: 'v0.1.0-experimental.1',
        channel: 'experimental',
        support: { ga: false, productionReady: false, sla: false, lts: false },
        buildArgs: ['UI4A_VERSION', 'UI4A_GIT_SHA', 'UI4A_BUILD_DATE'],
        labels: expect.arrayContaining([
          'org.opencontainers.image.version',
          'org.opencontainers.image.revision',
          'org.opencontainers.image.created',
          'io.ui4a.release.channel',
        ]),
      }),
    );
    expect(Object.keys(contract.images).sort()).toEqual(['runner', 'web', 'worker']);

    for (const [name, dockerfile] of Object.entries(imageFiles)) {
      const image = contract.images[name];
      expect(image?.dockerfile, name).toBe(dockerfile);
      expect(image?.entrypoint.length, name).toBeGreaterThan(0);
      expect(image?.health.command.length, name).toBeGreaterThan(0);
      expect(image?.health.versionEndpoint, name).toBe('/version');
      expect(image?.runAsNonRoot, name).toBe(true);
      expect(image?.readOnlyRootFilesystem, name).toBe(true);
      expect(image?.writablePaths.length, name).toBeGreaterThan(0);
      expect(image?.writablePaths, name).not.toContain('/');
    }
    expect(contract.images.web?.health.endpoint).toBe('/live');
  });

  it('pins the Runner Git, Pandoc and Codex requirements', () => {
    const dockerfile = requiredSource(imageFiles.runner);

    expect(dockerfile).toMatch(/^ARG GIT_VERSION=\S+$/m);
    expect(dockerfile).toMatch(/^ARG PANDOC_VERSION=\S+$/m);
    expect(dockerfile).toMatch(/^ARG CODEX_SDK_VERSION=0\.149\.0$/m);
    expect(dockerfile).toMatch(/git --version/);
    expect(dockerfile).toMatch(/pandoc --version/);
    expect(dockerfile).toContain('@openai/codex-sdk');
  });

  it('declares offline-auditable image smoke, metadata, SBOM and vulnerability commands', () => {
    const contract = JSON.parse(requiredSource('deploy/oci/image-contract.json')) as {
      verification: Record<string, string>;
    };

    expect(Object.keys(contract.verification).sort()).toEqual([
      'metadata',
      'sbom',
      'smoke',
      'vulnerability',
    ]);
    expect(contract.verification.smoke).toMatch(/docker run.+--read-only/);
    expect(contract.verification.metadata).toMatch(/docker inspect/);
    expect(contract.verification.sbom).toMatch(/syft.+cyclonedx-json/);
    expect(contract.verification.vulnerability).toMatch(/grype.+--fail-on high/);
  });
});
