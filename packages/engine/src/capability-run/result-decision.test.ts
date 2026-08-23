import { describe, expect, it } from 'vitest';

import { decideCodingResult, type CodingResultDecisionInput } from './index';

const result = {
  schemaVersion: 1 as const,
  resultId: 'result:1',
  baseRevision: 'a'.repeat(40),
  headRevision: 'b'.repeat(40),
  patch: { hash: `sha256:${'1'.repeat(64)}`, sizeBytes: 1, mediaType: 'text/x-diff' },
  trajectory: { hash: `sha256:${'2'.repeat(64)}`, sizeBytes: 1, mediaType: 'application/x-ndjson' },
  commits: [],
  changedFiles: ['src/a.ts'],
  testRuns: [{ command: 'pnpm test', exitCode: 0, passed: true }],
  summary: 'done',
};

function input(overrides: Partial<CodingResultDecisionInput> = {}): CodingResultDecisionInput {
  return {
    actor: 'human',
    principal: 'user:mike',
    requestedDecision: 'accept',
    runId: 'run-1',
    runRevision: 6,
    expectedRunRevision: 6,
    result,
    expectedResultId: 'result:1',
    currentBaseRevision: result.baseRevision,
    allowedPaths: ['src'],
    requiredTests: ['pnpm test'],
    verified: {
      patchHash: result.patch.hash,
      trajectoryHash: result.trajectory.hash,
      changedFiles: result.changedFiles,
      testRuns: result.testRuns,
    },
    ...overrides,
  };
}

describe('coding result decision', () => {
  it('accepts only a fully revalidated result and produces a no-merge receipt', () => {
    expect(decideCodingResult(input())).toMatchObject({
      decision: 'accepted',
      receipt: { runId: 'run-1', merged: false, deployed: false, activated: false },
    });
  });

  it('rejects agent decisions and explicit human rejection remains auditable', () => {
    expect(decideCodingResult(input({ actor: 'agent' }))).toMatchObject({
      decision: 'denied',
      code: 'human-required',
    });
    expect(
      decideCodingResult(input({ requestedDecision: 'reject', rejectionReason: 'not suitable' })),
    ).toMatchObject({ decision: 'rejected', receipt: { reason: 'not suitable' } });
  });

  it('returns stale on revision/base/result CAS drift', () => {
    expect(decideCodingResult(input({ currentBaseRevision: 'c'.repeat(40) }))).toMatchObject({
      decision: 'stale',
      code: 'base-stale',
    });
    expect(decideCodingResult(input({ expectedRunRevision: 5 }))).toMatchObject({
      decision: 'stale',
      code: 'run-stale',
    });
    expect(decideCodingResult(input({ expectedResultId: 'other' }))).toMatchObject({
      decision: 'stale',
      code: 'result-stale',
    });
  });

  it.each([
    {
      verified: {
        patchHash: `sha256:${'9'.repeat(64)}`,
        trajectoryHash: result.trajectory.hash,
        changedFiles: result.changedFiles,
        testRuns: result.testRuns,
      },
      code: 'artifact-integrity-failed',
    },
    {
      verified: {
        patchHash: result.patch.hash,
        trajectoryHash: result.trajectory.hash,
        changedFiles: ['outside/a.ts'],
        testRuns: result.testRuns,
      },
      code: 'changed-files-mismatch',
    },
    {
      result: { ...result, changedFiles: ['outside/a.ts'] },
      verified: {
        patchHash: result.patch.hash,
        trajectoryHash: result.trajectory.hash,
        changedFiles: ['outside/a.ts'],
        testRuns: result.testRuns,
      },
      code: 'path-outside-policy',
    },
    { requiredTests: ['pnpm check'], code: 'test-policy-failed' },
  ])('fails closed for invalid result %#', (override) => {
    expect(decideCodingResult(input(override as Partial<CodingResultDecisionInput>))).toMatchObject(
      { decision: 'denied', code: override.code },
    );
  });
});
