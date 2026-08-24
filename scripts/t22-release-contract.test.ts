import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLI_RELEASE_CHANNEL, CLI_RELEASE_TAG, CLI_VERSION } from '../apps/cli/src/release';
import { releaseMetadata as runnerReleaseMetadata } from '../apps/agent-runner/src/runtime';
import { workerReleaseMetadata } from '../apps/worker/src/runtime-health';
import { webReleaseMetadata } from '../apps/web/src/release';
import {
  RELEASE_CHANNEL,
  RELEASE_SUPPORT,
  RELEASE_TAG,
  RELEASE_VERSION,
} from '../packages/shared/src/release';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePaths = [
  'package.json',
  'apps/web/package.json',
  'apps/worker/package.json',
  'apps/agent-runner/package.json',
  'apps/cli/package.json',
  'packages/shared/package.json',
  'packages/engine/package.json',
  'packages/agent/package.json',
] as const;

function source(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('T22 repository release contract', () => {
  it('uses one canonical semver across workspace package metadata', () => {
    for (const path of packagePaths) {
      const manifest = JSON.parse(source(path)) as { version?: string };
      expect(manifest.version, path).toBe(RELEASE_VERSION);
    }
  });

  it('mechanically aligns the dependency-free installable CLI boundary', () => {
    expect(CLI_VERSION).toBe(RELEASE_VERSION);
    expect(CLI_RELEASE_TAG).toBe(RELEASE_TAG);
    expect(CLI_RELEASE_CHANNEL).toBe(RELEASE_CHANNEL);
  });

  it('aligns Web, Worker, and Runner release reporting', () => {
    const environment = {
      UI4A_VERSION: RELEASE_VERSION,
      UI4A_GIT_SHA: 'abc123',
      UI4A_BUILD_DATE: '2026-08-24T00:00:00Z',
    };
    for (const release of [
      webReleaseMetadata(environment),
      workerReleaseMetadata(environment),
      runnerReleaseMetadata(environment),
    ]) {
      expect(release).toMatchObject({
        version: RELEASE_VERSION,
        tag: RELEASE_TAG,
        channel: RELEASE_CHANNEL,
        support: RELEASE_SUPPORT,
        gitSha: 'abc123',
        buildDate: '2026-08-24T00:00:00Z',
      });
    }
  });

  it('aligns all image defaults and prohibits stable-release assurances', () => {
    const contract = JSON.parse(source('deploy/oci/image-contract.json')) as {
      release: {
        version: string;
        tag: string;
        channel: string;
        support: Record<string, boolean>;
      };
    };
    expect(contract.release).toEqual({
      version: RELEASE_VERSION,
      tag: RELEASE_TAG,
      channel: RELEASE_CHANNEL,
      support: RELEASE_SUPPORT,
      buildArgs: ['UI4A_VERSION', 'UI4A_GIT_SHA', 'UI4A_BUILD_DATE'],
      labels: [
        'org.opencontainers.image.version',
        'org.opencontainers.image.revision',
        'org.opencontainers.image.created',
        'io.ui4a.release.channel',
      ],
    });
    for (const path of [
      'apps/web/Dockerfile',
      'apps/worker/Dockerfile',
      'apps/agent-runner/Dockerfile',
    ]) {
      expect(source(path), path).toContain(`ARG UI4A_VERSION=${RELEASE_VERSION}`);
      expect(source(path), path).toContain('io.ui4a.release.channel="experimental"');
    }
  });
});
