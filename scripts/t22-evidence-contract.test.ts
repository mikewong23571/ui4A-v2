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

  it('records the live mothership platform without claiming unavailable infrastructure', () => {
    const probeJsonPath = trackFile('platform-probe.json');
    const probeMarkdownPath = trackFile('platform-probe.md');
    expect(existsSync(probeJsonPath), 'platform-probe.json must exist').toBe(true);
    expect(existsSync(probeMarkdownPath), 'platform-probe.md must exist').toBe(true);
    if (!existsSync(probeJsonPath) || !existsSync(probeMarkdownPath)) return;

    const probe = JSON.parse(readFileSync(probeJsonPath, 'utf8')) as {
      schemaVersion: number;
      mode: string;
      proxyEnvironment: string;
      cluster: {
        kubernetesVersion: string;
        istioVersion: string;
        containerdVersion: string;
        nodes: Array<{ name: string; ready: boolean; role: string }>;
        storageClasses: string[];
        gateways: string[];
        ingressNodePorts: number[];
      };
      imageSources: Array<{ component: string; status: string; source: string }>;
      storageCandidates: string[];
      constraints: string[];
    };

    expect(probe.schemaVersion).toBe(1);
    expect(probe.mode).toBe('read-only');
    expect(probe.proxyEnvironment).toBe('unset');
    expect(probe.cluster.kubernetesVersion).toBe('v1.31.14');
    expect(probe.cluster.istioVersion).toBe('1.24.2');
    expect(probe.cluster.containerdVersion).toBe('2.2.1');
    expect(probe.cluster.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'k8s-cp-1', ready: true, role: 'control-plane' }),
        expect.objectContaining({ name: 'k8s-w-1', ready: true, role: 'worker' }),
        expect.objectContaining({ name: 'k8s-w-2', ready: true, role: 'worker' }),
      ]),
    );
    expect(probe.cluster.storageClasses).toEqual([]);
    expect(probe.cluster.gateways).toEqual(
      expect.arrayContaining(['gateway-demo/demo-gateway', 'mattermost/mattermost-gateway']),
    );
    expect(probe.cluster.ingressNodePorts).toEqual(expect.arrayContaining([31534, 32067]));
    expect(probe.imageSources.map(({ component }) => component)).toEqual(
      expect.arrayContaining(['node', 'postgresql', 'temporal', 'keycloak', 'agent-runtime']),
    );
    for (const image of probe.imageSources) {
      expect(['available', 'blocked', 'build-required']).toContain(image.status);
      expect(image.source.length, image.component).toBeGreaterThan(0);
    }
    expect(probe.storageCandidates).toEqual(
      expect.arrayContaining(['static-local-pv', 'local-path-provisioner']),
    );
    expect(probe.constraints).toEqual(
      expect.arrayContaining([
        'no-storage-class',
        'cri-does-not-use-certs.d',
        'multi-arch-pulls-require-all-platforms',
        'istio-images-require-if-not-present',
        'mothership-setup-worktree-is-dirty',
      ]),
    );
  });

  it('records disposable Keycloak protocol results and the delegation stability boundary', () => {
    const probeJsonPath = trackFile('auth-probe.json');
    const probeMarkdownPath = trackFile('auth-probe.md');
    expect(existsSync(probeJsonPath), 'auth-probe.json must exist').toBe(true);
    expect(existsSync(probeMarkdownPath), 'auth-probe.md must exist').toBe(true);
    if (!existsSync(probeJsonPath) || !existsSync(probeMarkdownPath)) return;

    const probeText = readFileSync(probeJsonPath, 'utf8');
    const probe = JSON.parse(probeText) as {
      schemaVersion: number;
      keycloak: {
        version: string;
        imageDigest: string;
        mode: string;
      };
      flows: {
        authorizationCodePkce: { status: string; codeChallengeMethod: string };
        clientCredentials: { status: string };
        standardTokenExchange: { status: string; standard: string };
        actDelegation: { status: string; stability: string };
        publicClientExchange: { status: string; expectedRejection: boolean };
      };
      boundary: {
        istio: string[];
        application: string[];
      };
      sources: string[];
    };

    expect(probe.schemaVersion).toBe(1);
    expect(probe.keycloak.version).toBe('26.7.1');
    expect(probe.keycloak.imageDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(probe.keycloak.mode).toBe('disposable-start-dev');
    expect(probe.flows.authorizationCodePkce).toEqual({
      status: 'passed',
      codeChallengeMethod: 'S256',
    });
    expect(probe.flows.clientCredentials.status).toBe('passed');
    expect(probe.flows.standardTokenExchange).toEqual({
      status: 'passed',
      standard: 'RFC 8693 internal-to-internal',
    });
    expect(probe.flows.actDelegation.stability).toBe('experimental');
    expect(['passed', 'blocked']).toContain(probe.flows.actDelegation.status);
    expect(probe.flows.publicClientExchange).toEqual({
      status: 'passed',
      expectedRejection: true,
    });
    expect(probe.boundary.istio).toEqual(
      expect.arrayContaining(['issuer-signature-audience', 'coarse-route-policy']),
    );
    expect(probe.boundary.application).toEqual(
      expect.arrayContaining([
        'actor-principal-scope-derivation',
        'delegation-chain-validation',
        'human-only-approval',
      ]),
    );
    expect(probe.sources.every((source) => source.startsWith('https://www.keycloak.org/'))).toBe(
      true,
    );
    expect(probeText).not.toMatch(
      /probe-admin-password|probe-human-password|probe-agent-secret|access_token|refresh_token/,
    );
  });
});
