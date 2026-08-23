import { join } from 'node:path';

import { heartbeat } from '@temporalio/activity';

import { type CapabilityRun, type CapabilityRunCommand } from '@ui4a/engine';
import type {
  CodingExecutorProfile,
  CodingNormalizedEvent,
  CodingResult,
  CodingTask,
  WorkspaceHandle,
} from '@ui4a/shared';

import {
  appendCapabilityNormalizedEvent,
  appendCapabilityRawEvent,
  appendCapabilityRunCommand,
  capabilityRawStats,
  getCapabilityRun,
  listCapabilityNormalizedEvents,
  storeCapabilityPayload,
} from '../../../../web/src/db/capability-runs';
import type { DbExecutor } from '../../../../web/src/db/events';

import { executeCodexTask, probeCodexExecutor, type CodexExecutionOutput } from './codex';
import {
  collectGitWorkspace,
  parseRepositoryRegistry,
  prepareGitWorkspace,
  type GitWorkspaceHandle,
} from './workspace';

export interface CodingRunContext {
  runId: string;
  principal: string;
  policyScope: string;
  profileName: string;
  task: CodingTask;
}

export interface PreparedCodingRun {
  workspace: WorkspaceHandle;
}

export type CodingRunOutcome =
  | { status: 'succeeded'; result: CodingResult }
  | { status: 'failed'; code: string; reason: string }
  | { status: 'cancelled'; reason: string };

export interface CodingRuntimeDeps {
  db: DbExecutor;
  repositoryRegistry: string;
  workspaceRoot: string;
  profiles: CodingExecutorProfile[];
  execute?: typeof executeCodexTask;
  heartbeat?: (details: unknown) => void;
  probe?: (profileName: string) => Promise<{ available: boolean; reason?: string }>;
}

function profileOf(profiles: CodingExecutorProfile[], name: string): CodingExecutorProfile {
  const profile = profiles.find((candidate) => candidate.name === name);
  if (profile === undefined) throw new Error(`coding executor profile ${name} is missing`);
  if (profile.providerId !== 'codex')
    throw new Error(`coding executor provider ${profile.providerId} is unavailable`);
  return profile;
}

function sharedWorkspace(handle: GitWorkspaceHandle, allowedPaths: string[]): WorkspaceHandle {
  return {
    schemaVersion: 1,
    workspaceId: handle.id,
    repositoryRef: handle.repositoryRef,
    baseRevision: handle.baseRevision,
    branch: handle.branch,
    leaseId: `lease:${handle.id}`,
    allowedPaths,
    mainCheckoutFingerprint: handle.mainCheckoutFingerprint,
  };
}

async function currentRun(db: DbExecutor, context: CodingRunContext): Promise<CapabilityRun> {
  const run = await getCapabilityRun(db, context.runId, context.principal, context.policyScope);
  if (run === undefined) throw new Error('capability run does not exist');
  return run;
}

async function command(
  deps: CodingRuntimeDeps,
  context: CodingRunContext,
  build: (run: CapabilityRun) => CapabilityRunCommand,
): Promise<CapabilityRun> {
  const run = await currentRun(deps.db, context);
  return (await appendCapabilityRunCommand(deps.db, build(run))).aggregate;
}

/** Prepare the platform-owned worktree and move the Run to preparing. */
export async function prepareCodingRunWithDeps(
  context: CodingRunContext,
  deps: CodingRuntimeDeps,
): Promise<PreparedCodingRun> {
  profileOf(deps.profiles, context.profileName);
  const descriptor = await (deps.probe ?? probeCodexExecutor)(context.profileName);
  if (!descriptor.available) {
    await command(deps, context, (current) => ({
      kind: 'fail',
      runId: context.runId,
      expectedRevision: current.revision,
      commandId: `preflight-failed:${context.runId}`,
      eventId: `event:preflight-failed:${context.runId}`,
      code: 'provider-unavailable',
      reason: descriptor.reason ?? 'coding executor unavailable',
    }));
    throw new Error(descriptor.reason ?? 'coding executor unavailable');
  }
  let run = await currentRun(deps.db, context);
  if (run.status === 'queued') {
    run = await command(deps, context, (current) => ({
      kind: 'prepare',
      runId: context.runId,
      expectedRevision: current.revision,
      commandId: `prepare:${context.runId}`,
      eventId: `event:prepare:${context.runId}`,
    }));
  }
  if (run.status !== 'preparing' && run.status !== 'running') {
    throw new Error(`capability run cannot prepare from ${run.status}`);
  }
  const registry = parseRepositoryRegistry(deps.repositoryRegistry);
  const handle = await prepareGitWorkspace(
    {
      runId: context.runId,
      repositoryRef: context.task.repositoryRef,
      baseRevision: context.task.baseRevision,
      policyScope: context.policyScope,
    },
    { registry, workspaceRoot: deps.workspaceRoot },
  );
  return { workspace: sharedWorkspace(handle, context.task.allowedPaths) };
}

function internalWorkspace(
  context: CodingRunContext,
  deps: CodingRuntimeDeps,
  workspace: WorkspaceHandle,
): GitWorkspaceHandle {
  const registry = parseRepositoryRegistry(deps.repositoryRegistry);
  const entry = registry[context.task.repositoryRef];
  if (entry === undefined) throw new Error('repository disappeared from registry');
  return {
    id: workspace.workspaceId,
    repositoryRef: workspace.repositoryRef,
    repositoryPath: entry.path,
    path: join(deps.workspaceRoot, context.runId),
    branch: workspace.branch,
    baseRevision: workspace.baseRevision,
    mainCheckoutFingerprint: workspace.mainCheckoutFingerprint,
  };
}

function testRunsFromEvents(events: CodingNormalizedEvent[], claimed: string[]) {
  const started = new Map<string, string>();
  const completed = new Map<string, number>();
  for (const event of events) {
    if (event.kind === 'command-started') started.set(event.commandId, event.summary);
    if (event.kind === 'command-completed') completed.set(event.commandId, event.exitCode);
  }
  return claimed.map((claimedCommand) => {
    // Provider claims are descriptive labels (for example `npm test — passed`),
    // while the audit record must point at the command that UI4A observed.
    const commandPrefix = claimedCommand
      .split(/\s+(?:—|–|-)\s+|:|\s+(?:passes|passed)\b|\s+\(/iu, 1)[0]!
      .trim();
    const match = [...started].find(
      ([, command]) =>
        command.includes(claimedCommand) ||
        (commandPrefix.length >= 3 && command.includes(commandPrefix)),
    );
    const exitCode = match === undefined ? 1 : (completed.get(match[0]) ?? 1);
    return {
      command: match?.[1] ?? claimedCommand,
      exitCode,
      passed: exitCode === 0,
    };
  });
}

/** Execute/resume the configured provider, persist progress, and independently collect Git evidence. */
export async function executeCodingRunWithDeps(
  context: CodingRunContext,
  prepared: PreparedCodingRun,
  deps: CodingRuntimeDeps,
  signal?: AbortSignal,
): Promise<CodingRunOutcome> {
  const profile = profileOf(deps.profiles, context.profileName);
  const workspace = internalWorkspace(context, deps, prepared.workspace);
  const execute = deps.execute ?? executeCodexTask;
  let rawOrdinal = (await capabilityRawStats(deps.db, context.runId)).maxOrdinal;
  try {
    const existing = await currentRun(deps.db, context);
    const output: CodexExecutionOutput = await execute(
      {
        runId: context.runId,
        task: context.task,
        profile,
        workspace: { id: workspace.id, path: workspace.path },
        ...(existing.handle?.nativeSessionId === undefined
          ? {}
          : { nativeSessionId: existing.handle.nativeSessionId }),
        ...(signal === undefined ? {} : { signal }),
      },
      {
        onRaw: async (event, cursor) => {
          rawOrdinal += 1;
          await appendCapabilityRawEvent(deps.db, {
            runId: context.runId,
            principal: context.principal,
            policyScope: context.policyScope,
            ordinal: rawOrdinal,
            cursor,
            payload: event,
            workspacePath: workspace.path,
            redaction: context.task.redaction,
          });
        },
        onNormalized: async (event) => {
          let run = await currentRun(deps.db, context);
          if (event.kind === 'run-started' && run.status === 'preparing') {
            run = await command(deps, context, (current) => ({
              kind: 'start',
              runId: context.runId,
              expectedRevision: current.revision,
              commandId: `start:${context.runId}`,
              eventId: `event:start:${context.runId}`,
              workspace: prepared.workspace,
              handle: {
                schemaVersion: 1,
                runId: context.runId,
                profileName: context.profileName,
                workspaceId: prepared.workspace.workspaceId,
                ...(event.nativeSessionId === undefined
                  ? {}
                  : { nativeSessionId: event.nativeSessionId }),
              },
            }));
          }
          await appendCapabilityNormalizedEvent(deps.db, {
            event,
            principal: context.principal,
            policyScope: context.policyScope,
          });
          run = await currentRun(deps.db, context);
          if (run.status === 'running') {
            await command(deps, context, (current) => ({
              kind: 'advance-cursor',
              runId: context.runId,
              expectedRevision: current.revision,
              expectedCursor: current.cursor,
              cursor: `${rawOrdinal}`,
              normalizedSequence: event.sequence,
              commandId: `cursor:${context.runId}:${event.sequence}`,
              eventId: `event:cursor:${context.runId}:${event.sequence}`,
            }));
          }
          (deps.heartbeat ?? heartbeat)({ runId: context.runId, cursor: rawOrdinal });
        },
      },
    );
    const collected = await collectGitWorkspace(workspace, context.task.allowedPaths);
    if (collected.mainCheckoutFingerprint !== workspace.mainCheckoutFingerprint) {
      throw new Error('main checkout changed during coding run');
    }
    const normalized = await listCapabilityNormalizedEvents(deps.db, context.runId);
    const tests = testRunsFromEvents(normalized, output.claim.tests);
    if (tests.length === 0 || tests.some((test) => !test.passed)) {
      throw new Error('provider result did not include independently observed passing tests');
    }
    const patch = await storeCapabilityPayload(deps.db, collected.patch, 'text/x-diff');
    const trajectory = await storeCapabilityPayload(deps.db, normalized, 'application/x-ndjson');
    const result: CodingResult = {
      schemaVersion: 1,
      resultId: `result:${context.runId}`,
      baseRevision: collected.baseRevision,
      headRevision: collected.headRevision,
      patch: { hash: patch.hash, sizeBytes: patch.bytes, mediaType: 'text/x-diff' },
      trajectory: {
        hash: trajectory.hash,
        sizeBytes: trajectory.bytes,
        mediaType: 'application/x-ndjson',
      },
      commits: [],
      changedFiles: collected.changedFiles,
      testRuns: tests,
      summary: output.claim.summary,
      providerDetail: { provider: 'codex', nativeSessionId: output.nativeSessionId },
    };
    await command(deps, context, (current) => ({
      kind: 'succeed',
      runId: context.runId,
      expectedRevision: current.revision,
      commandId: `succeed:${context.runId}`,
      eventId: `event:succeed:${context.runId}`,
      result,
    }));
    return { status: 'succeeded', result };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const run = await currentRun(deps.db, context);
    if (!['succeeded', 'failed', 'cancelled', 'stale'].includes(run.status)) {
      const cancelled = signal?.aborted === true;
      await command(deps, context, (current) =>
        cancelled
          ? {
              kind: 'cancel',
              runId: context.runId,
              expectedRevision: current.revision,
              commandId: `cancel:${context.runId}`,
              eventId: `event:cancel:${context.runId}`,
              reason,
            }
          : {
              kind: 'fail',
              runId: context.runId,
              expectedRevision: current.revision,
              commandId: `fail:${context.runId}`,
              eventId: `event:fail:${context.runId}`,
              code: 'executor-failed',
              reason,
            },
      );
      return cancelled
        ? { status: 'cancelled', reason }
        : { status: 'failed', code: 'executor-failed', reason };
    }
    throw error;
  }
}

export function parseExecutorProfiles(input: string): CodingExecutorProfile[] {
  const value = JSON.parse(input) as unknown;
  if (!Array.isArray(value)) throw new Error('coding executor profiles must be an array');
  return value as CodingExecutorProfile[];
}
