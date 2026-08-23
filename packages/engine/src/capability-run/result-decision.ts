import type { CodingResult, CodingTestRun } from '@ui4a/shared';

import { validateAllowedPath } from './workspace-policy';

export interface VerifiedCodingResult {
  patchHash: string;
  trajectoryHash: string;
  changedFiles: string[];
  testRuns: CodingTestRun[];
}

export interface CodingResultDecisionInput {
  actor: 'human' | 'agent' | 'system';
  principal: string;
  requestedDecision: 'accept' | 'reject';
  rejectionReason?: string;
  runId: string;
  runRevision: number;
  expectedRunRevision: number;
  result: CodingResult;
  expectedResultId: string;
  currentBaseRevision: string;
  allowedPaths: string[];
  requiredTests: string[];
  verified: VerifiedCodingResult;
}

export interface CodingResultDecisionReceipt {
  runId: string;
  resultId: string;
  principal: string;
  runRevision: number;
  decision: 'accepted' | 'rejected';
  reason?: string;
  merged: false;
  deployed: false;
  activated: false;
}

export type CodingResultDecision =
  | { decision: 'accepted'; receipt: CodingResultDecisionReceipt }
  | { decision: 'rejected'; receipt: CodingResultDecisionReceipt }
  | {
      decision: 'stale';
      code: 'run-stale' | 'result-stale' | 'base-stale';
      reason: string;
    }
  | {
      decision: 'denied';
      code:
        | 'human-required'
        | 'rejection-reason-required'
        | 'artifact-integrity-failed'
        | 'changed-files-mismatch'
        | 'path-outside-policy'
        | 'test-policy-failed';
      reason: string;
    };

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function sameTests(left: readonly CodingTestRun[], right: readonly CodingTestRun[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((test, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      test.command === other.command &&
      test.exitCode === other.exitCode &&
      test.passed === other.passed
    );
  });
}

function pathAllowed(path: string, allowedPaths: readonly string[]): boolean {
  if (validateAllowedPath(path).length > 0) return false;
  return allowedPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

/** Revalidate a successful Coding Result for an explicit human decision; never merges or deploys. */
export function decideCodingResult(input: CodingResultDecisionInput): CodingResultDecision {
  if (input.actor !== 'human') {
    return {
      decision: 'denied',
      code: 'human-required',
      reason: 'coding result decisions require a human actor',
    };
  }
  if (input.runRevision !== input.expectedRunRevision) {
    return {
      decision: 'stale',
      code: 'run-stale',
      reason: `run revision changed from ${input.expectedRunRevision} to ${input.runRevision}`,
    };
  }
  if (input.result.resultId !== input.expectedResultId) {
    return {
      decision: 'stale',
      code: 'result-stale',
      reason: `result changed from ${input.expectedResultId} to ${input.result.resultId}`,
    };
  }
  if (input.currentBaseRevision !== input.result.baseRevision) {
    return {
      decision: 'stale',
      code: 'base-stale',
      reason: `repository base changed from ${input.result.baseRevision} to ${input.currentBaseRevision}`,
    };
  }
  if (input.requestedDecision === 'reject') {
    if (input.rejectionReason === undefined || input.rejectionReason.trim() === '') {
      return {
        decision: 'denied',
        code: 'rejection-reason-required',
        reason: 'a human rejection must include an actionable reason',
      };
    }
    return {
      decision: 'rejected',
      receipt: {
        runId: input.runId,
        resultId: input.result.resultId,
        principal: input.principal,
        runRevision: input.runRevision,
        decision: 'rejected',
        reason: input.rejectionReason,
        merged: false,
        deployed: false,
        activated: false,
      },
    };
  }
  if (
    input.result.patch.hash !== input.verified.patchHash ||
    input.result.trajectory.hash !== input.verified.trajectoryHash ||
    !/^sha256:[0-9a-f]{64}$/.test(input.result.patch.hash) ||
    !/^sha256:[0-9a-f]{64}$/.test(input.result.trajectory.hash)
  ) {
    return {
      decision: 'denied',
      code: 'artifact-integrity-failed',
      reason: 'result artifact hashes do not match independently verified content',
    };
  }
  if (!sameStrings(input.result.changedFiles, input.verified.changedFiles)) {
    return {
      decision: 'denied',
      code: 'changed-files-mismatch',
      reason: 'reported changed files do not match the workspace diff',
    };
  }
  const outside = input.result.changedFiles.find((path) => !pathAllowed(path, input.allowedPaths));
  if (outside !== undefined) {
    return {
      decision: 'denied',
      code: 'path-outside-policy',
      reason: `changed file ${outside} is outside the allowed paths`,
    };
  }
  const verifiedTestsMatch = sameTests(input.result.testRuns, input.verified.testRuns);
  const requiredTestsPass = input.requiredTests.every((command) =>
    input.result.testRuns.some(
      (test) => test.command === command && test.passed && test.exitCode === 0,
    ),
  );
  if (!verifiedTestsMatch || !requiredTestsPass) {
    return {
      decision: 'denied',
      code: 'test-policy-failed',
      reason: 'required tests are missing, failing, or do not match verified executions',
    };
  }
  return {
    decision: 'accepted',
    receipt: {
      runId: input.runId,
      resultId: input.result.resultId,
      principal: input.principal,
      runRevision: input.runRevision,
      decision: 'accepted',
      merged: false,
      deployed: false,
      activated: false,
    },
  };
}
