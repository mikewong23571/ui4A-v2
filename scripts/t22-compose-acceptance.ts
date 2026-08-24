import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const composeStoryIds = [
  'U1',
  'U3',
  'U4',
  'U5',
  'U6',
  'U7',
  'U8',
  'U9',
  'U13',
  'U14',
  'U16',
] as const;

type ComposeStoryId = (typeof composeStoryIds)[number];

const routes: Record<ComposeStoryId, string> = {
  U1: 'clean-start-and-retention',
  U3: 'browser-oidc',
  U4: 'cli-bearer',
  U5: 'delegation-exchange',
  U6: 'approval-boundary',
  U7: 'container-runtime',
  U8: 'host-runtime',
  U9: 'runtime-overrides',
  U13: 'tls-and-oidc-origins',
  U14: 'dependency-failure-matrix',
  U16: 'cross-environment-corpus',
};

export interface ComposeAcceptancePlan {
  schemaVersion: 1;
  environment: 'compose';
  stories: Array<{
    storyId: ComposeStoryId;
    route: string;
    execution: 'operator-authorized-live';
  }>;
  runtimePaths: {
    U7: { runnerId: string; origin: string; route: '/deliver'; fallback: false };
    U8: { runnerId: string; origin: string; route: '/deliver'; fallback: false };
  };
  provenance: {
    releaseGitShaSource: 'UI4A_RELEASE_GIT_SHA';
    operatorGitShaSource: 'git rev-parse HEAD';
    relationship: 'ancestor-or-equal';
  };
}

function fail(): never {
  throw new TypeError('COMPOSE_ACCEPTANCE_EVIDENCE_INVALID');
}

export function planComposeStoryAcceptance(): ComposeAcceptancePlan {
  return {
    schemaVersion: 1,
    environment: 'compose',
    stories: composeStoryIds.map((storyId) => ({
      storyId,
      route: routes[storyId],
      execution: 'operator-authorized-live',
    })),
    runtimePaths: {
      U7: {
        runnerId: 'compose-container-runner',
        origin: 'https://ui4a.mothership.internal:8443',
        route: '/deliver',
        fallback: false,
      },
      U8: {
        runnerId: 'compose-host-runner',
        origin: 'https://ui4a.mothership.internal:9444',
        route: '/deliver',
        fallback: false,
      },
    },
    provenance: {
      releaseGitShaSource: 'UI4A_RELEASE_GIT_SHA',
      operatorGitShaSource: 'git rev-parse HEAD',
      relationship: 'ancestor-or-equal',
    },
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function hasSensitiveKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      /secret|token|password|cookie|private.?key/i.test(key) || hasSensitiveKey(nested),
  );
}

export function validateComposeStoryEvidence<T>(value: T): T {
  const evidence = object(value);
  const requiredKeys = [
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
  ];
  const allowedKeys = [...requiredKeys, 'identity', 'notes'];
  if (
    Object.keys(evidence).some((key) => !allowedKeys.includes(key)) ||
    requiredKeys.some((key) => !(key in evidence)) ||
    evidence.schemaVersion !== 1 ||
    evidence.trackId !== 't22-production-deployment-auth-runtime_20260824' ||
    evidence.release !== 'v0.1.0-experimental.1' ||
    typeof evidence.gitSha !== 'string' ||
    !/^[0-9a-f]{7,40}$/.test(evidence.gitSha) ||
    evidence.environment !== 'compose' ||
    !composeStoryIds.includes(evidence.storyId as ComposeStoryId) ||
    !['passed', 'failed', 'blocked'].includes(String(evidence.status)) ||
    !Array.isArray(evidence.commands) ||
    evidence.commands.length === 0 ||
    !Array.isArray(evidence.artifacts) ||
    !Array.isArray(evidence.assertions) ||
    evidence.assertions.length === 0 ||
    typeof evidence.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(evidence.startedAt)) ||
    typeof evidence.finishedAt !== 'string' ||
    !Number.isFinite(Date.parse(evidence.finishedAt)) ||
    hasSensitiveKey(evidence)
  ) {
    fail();
  }
  for (const command of evidence.commands) {
    const item = object(command);
    if (
      Object.keys(item).some((key) => !['command', 'exitCode', 'summary'].includes(key)) ||
      typeof item.command !== 'string' ||
      item.command === '' ||
      !Number.isInteger(item.exitCode) ||
      typeof item.summary !== 'string' ||
      item.summary === ''
    ) {
      fail();
    }
  }
  for (const assertion of evidence.assertions) {
    const item = object(assertion);
    if (
      Object.keys(item).some((key) => !['name', 'expected', 'actual', 'status'].includes(key)) ||
      typeof item.name !== 'string' ||
      item.name === '' ||
      !['passed', 'failed'].includes(String(item.status))
    ) {
      fail();
    }
  }
  for (const artifact of evidence.artifacts) {
    const item = object(artifact);
    if (
      Object.keys(item).some((key) => !['kind', 'ref', 'digest'].includes(key)) ||
      ![
        'oci-image',
        'event-log',
        'workflow-history',
        'agent-result',
        'backup',
        'certificate',
        'report',
      ].includes(String(item.kind)) ||
      typeof item.ref !== 'string' ||
      item.ref === '' ||
      typeof item.digest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(item.digest)
    ) {
      fail();
    }
  }
  if (evidence.identity !== undefined) {
    const identity = object(evidence.identity);
    if (
      Object.keys(identity).some(
        (key) =>
          !['actor', 'subject', 'authorizedParty', 'delegationBasis', 'scopes'].includes(key),
      ) ||
      !['human', 'agent', 'system'].includes(String(identity.actor)) ||
      typeof identity.subject !== 'string' ||
      identity.subject === '' ||
      !Array.isArray(identity.scopes) ||
      identity.scopes.some((scope) => typeof scope !== 'string' || scope === '') ||
      new Set(identity.scopes).size !== identity.scopes.length ||
      (identity.actor === 'agent' &&
        (typeof identity.authorizedParty !== 'string' || identity.delegationBasis !== 'sub+azp'))
    ) {
      fail();
    }
  }
  if (evidence.notes !== undefined && typeof evidence.notes !== 'string') fail();
  return value;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).join('\0') !== 'plan') {
    process.stderr.write(
      `${JSON.stringify({ ok: false, code: 'COMPOSE_ACCEPTANCE_USAGE_INVALID' })}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, plan: planComposeStoryAcceptance() })}\n`);
}

const directEntry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (directEntry === import.meta.url) void main();
