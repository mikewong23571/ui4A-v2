import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { planComposeStoryAcceptance, validateComposeStoryEvidence } from './t22-compose-acceptance';

const contractPath = 'deploy/compose/acceptance-contract.json';
const storyIds = ['U1', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8', 'U9', 'U13', 'U14', 'U16'];
const execFileAsync = promisify(execFile);

describe('T22 Compose story acceptance runner contract', () => {
  it('defines one deterministic, non-destructive runner over the required Phase G stories', () => {
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as Record<string, unknown>;
    const plan = planComposeStoryAcceptance();

    expect(contract).toMatchObject({
      schemaVersion: 1,
      environment: 'compose',
      evidenceSchema:
        'conductor/tracks/t22-production-deployment-auth-runtime_20260824/acceptance-evidence.schema.json',
      stories: storyIds,
    });
    expect(plan.stories.map(({ storyId }) => storyId)).toEqual(storyIds);
    expect(plan.stories.every(({ execution }) => execution === 'operator-authorized-live')).toBe(
      true,
    );
    expect(JSON.stringify(plan)).not.toMatch(/down --volumes|compose clean|secret|token|password/i);
  });

  it('accepts only schema-shaped, Compose-scoped evidence for a planned story', () => {
    const evidence = {
      schemaVersion: 1,
      trackId: 't22-production-deployment-auth-runtime_20260824',
      release: 'v0.1.0-experimental.1',
      gitSha: 'abcdef0123456789',
      environment: 'compose',
      storyId: 'U1',
      status: 'passed',
      commands: [
        { command: 'pnpm compose:t22 preflight', exitCode: 0, summary: 'preflight passed' },
      ],
      artifacts: [],
      assertions: [{ name: 'readiness', expected: 'ready', actual: 'ready', status: 'passed' }],
      startedAt: '2026-08-24T12:00:00.000Z',
      finishedAt: '2026-08-24T12:01:00.000Z',
    };

    expect(validateComposeStoryEvidence(evidence)).toEqual(evidence);
    expect(() => validateComposeStoryEvidence({ ...evidence, environment: 'kubernetes' })).toThrow(
      'COMPOSE_ACCEPTANCE_EVIDENCE_INVALID',
    );
    expect(() => validateComposeStoryEvidence({ ...evidence, storyId: 'U2' })).toThrow(
      'COMPOSE_ACCEPTANCE_EVIDENCE_INVALID',
    );
    expect(() =>
      validateComposeStoryEvidence({ ...evidence, refreshToken: '__private_material__' }),
    ).toThrow('COMPOSE_ACCEPTANCE_EVIDENCE_INVALID');
  });

  it('exposes a plan-only CLI and rejects any unplanned live command', async () => {
    const planned = await execFileAsync(
      'apps/worker/node_modules/.bin/tsx',
      ['scripts/t22-compose-acceptance.ts', 'plan'],
      { cwd: process.cwd() },
    );
    expect(JSON.parse(planned.stdout)).toMatchObject({
      ok: true,
      plan: { environment: 'compose' },
    });
    expect(planned.stdout).not.toMatch(/secret|token|password/i);

    await expect(
      execFileAsync(
        'apps/worker/node_modules/.bin/tsx',
        ['scripts/t22-compose-acceptance.ts', 'run'],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: '{"ok":false,"code":"COMPOSE_ACCEPTANCE_USAGE_INVALID"}\n',
    });
  });
});
