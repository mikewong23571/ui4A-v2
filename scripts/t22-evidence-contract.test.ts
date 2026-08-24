import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const trackRoot = resolve(
  repositoryRoot,
  'conductor/tracks/t22-production-deployment-auth-runtime_20260824',
);

const storyIds = Array.from({ length: 17 }, (_, index) => 'U' + (index + 1));

function trackFile(name: string): string {
  return resolve(trackRoot, name);
}

function readTrackFile(name: string): string {
  return readFileSync(trackFile(name), 'utf8');
}

describe('T22 executable acceptance contract', () => {
  it('defines every U1-U17 story exactly once', () => {
    const stories = readTrackFile('user-stories.md');
    const headings = [...stories.matchAll(/^### (U\d+) /gm)].map((match) => match[1]);

    expect(headings).toEqual(storyIds);
  });

  it('provides technical stories, a machine-readable evidence schema and a red baseline', () => {
    for (const name of [
      'technical-stories.md',
      'acceptance-evidence.schema.json',
      'acceptance-baseline.json',
    ]) {
      expect(existsSync(trackFile(name)), name + ' must exist').toBe(true);
    }
  });

  it('routes both deployment shapes through one complete red baseline', () => {
    const baselinePath = trackFile('acceptance-baseline.json');
    expect(existsSync(baselinePath), 'acceptance-baseline.json must exist').toBe(true);
    if (!existsSync(baselinePath)) return;

    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      schemaVersion: number;
      trackId: string;
      release: string;
      status: string;
      environments: string[];
      stories: Array<{ storyId: string; status: string; routes: string[] }>;
      goldenStory: string[];
      negativeCases: string[];
      requiredEvidence: string[];
    };

    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.trackId).toBe('t22-production-deployment-auth-runtime_20260824');
    expect(baseline.release).toBe('v0.1.0-experimental.1');
    expect(baseline.status).toBe('red-baseline');
    expect(baseline.environments).toEqual(['compose', 'kubernetes']);
    expect(baseline.stories.map(({ storyId }) => storyId)).toEqual(storyIds);
    for (const story of baseline.stories) {
      expect(story.status, story.storyId).toBe('red');
      expect(story.routes.length, story.storyId).toBeGreaterThan(0);
    }
    expect(baseline.goldenStory).toHaveLength(12);
    expect(baseline.negativeCases).toEqual(
      expect.arrayContaining([
        'missing-token',
        'expired-token',
        'wrong-issuer',
        'wrong-audience',
        'invalid-signature',
        'forged-human-actor',
        'forged-principal',
        'over-scoped-token-exchange',
        'agent-approval',
        'runtime-backend-override',
      ]),
    );
    expect(baseline.requiredEvidence).toEqual(
      expect.arrayContaining([
        'build-provenance',
        'deployment-inventory',
        'identity',
        'runtime-matrix',
        'concurrency-replay',
        'backup-restore',
        'runbook-replay',
        'experimental-release',
      ]),
    );
  });

  it('defines a strict evidence envelope without secret-bearing fields', () => {
    const schemaPath = trackFile('acceptance-evidence.schema.json');
    expect(existsSync(schemaPath), 'acceptance-evidence.schema.json must exist').toBe(true);
    if (!existsSync(schemaPath)) return;

    const schemaText = readFileSync(schemaPath, 'utf8');
    const schema = JSON.parse(schemaText) as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown>;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'trackId',
        'release',
        'gitSha',
        'environment',
        'storyId',
        'status',
        'commands',
        'artifacts',
        'assertions',
        'startedAt',
        'finishedAt',
      ]),
    );
    expect(Object.keys(schema.properties)).not.toEqual(
      expect.arrayContaining(['token', 'secret', 'password', 'apiKey', 'privateKey']),
    );
    expect(schemaText).not.toMatch(/LLM_API_KEY|tls\.key|ca\.key/);
  });
});
