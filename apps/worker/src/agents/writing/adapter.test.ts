import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashCanonicalAgentJson, type AgentRunCommand, type AgentRunJson } from '@ui4a/engine';
import type { WritingBrief, WritingResult } from '@ui4a/shared';

import {
  appendAgentRunCommand,
  ensureAgentRunTables,
  getAgentRun,
} from '../../../../web/src/db/agent-runs';
import { ensureEventsTable } from '../../../../web/src/db/events';
import { getPool } from '../../../../web/src/db/pool';
import type { CodexStructuredDeps, CodexStructuredInput } from '../host/codex-transport';
import type { AgentRunWorkflowArgs } from '../host/contracts';
import {
  collectWritingAgentRunWithDeps,
  executeWritingAgentRunWithDeps,
  finalizeWritingAgentRunWithDeps,
  parseDocumentAgentProfiles,
  prepareWritingAgentRunWithDeps,
  verifyWritingAgentRun,
  type DocumentAgentProfile,
} from './adapter';

const hash = (value: string): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const profile: DocumentAgentProfile = {
  name: 'test-document-codex',
  runtimeClass: 'document-agent',
  providerId: 'codex',
  transport: 'sdk',
  model: 'deployment-selected',
  apiKeyEnv: 'CODEX_HOME',
  artifactBackend: 'isolated-document-workspace',
  timeoutSeconds: 120,
  maxTurns: 10,
  envAllowlist: ['PATH'],
  networkPolicy: 'none',
};

describe.sequential('writing-agent@1 generic Host adapter', () => {
  it('rejects malformed or widening deployment profiles', () => {
    expect(parseDocumentAgentProfiles(JSON.stringify([profile]))).toEqual([profile]);
    expect(() => parseDocumentAgentProfiles('[]')).not.toThrow();
    expect(() =>
      parseDocumentAgentProfiles(JSON.stringify([{ ...profile, runtimeClass: 'coding-agent' }])),
    ).toThrow(/invalid/i);
    expect(() =>
      parseDocumentAgentProfiles(JSON.stringify([{ ...profile, artifactBackend: 'repository' }])),
    ).toThrow(/invalid/i);
  });

  it('runs prepare/execute/collect/verify/finalize with independently observed evidence', async () => {
    const db = getPool(
      process.env.TEST_DATABASE_URL ?? 'postgres://ui4a:ui4a@localhost:5433/ui4a_test',
    );
    await ensureEventsTable(db);
    await ensureAgentRunTables(db);
    const runId = `t19-writing-${randomUUID()}`;
    const sourceText = 'The event log is authoritative.\n';
    const brief: WritingBrief = {
      schemaVersion: 1,
      objective: 'Write a concise architecture note.',
      audience: 'engineers',
      format: 'markdown',
      requiredSections: ['Architecture'],
      constraints: ['Use supplied sources only'],
      allowedOutputPaths: ['out/article.md'],
      sources: [
        {
          id: 'S1',
          title: 'Architecture source',
          mediaType: 'text/plain',
          content: sourceText,
          hash: hash(sourceText),
        },
      ],
      citationPolicy: { style: 'paragraph-markers', requireEveryFactualParagraph: true },
      budget: {
        timeoutSeconds: 120,
        maxTurns: 10,
        maxRawEvents: 100,
        maxRawBytes: 200_000,
        maxRawChunkBytes: 20_000,
      },
    };
    const messages = [
      {
        blockId: 'authority',
        role: 'system' as const,
        purpose: 'authority',
        content: 'Use only supplied task data and write only the authorized artifact.',
        sealed: true,
      },
      {
        blockId: 'brief',
        role: 'user' as const,
        purpose: 'task-data',
        content: JSON.stringify(brief),
        sealed: false,
      },
    ];
    const compiledHash = hashCanonicalAgentJson(messages as unknown as AgentRunJson);
    const args: AgentRunWorkflowArgs = {
      runId,
      principal: 'user:t19-writing-test',
      policyScope: 'editorial',
      source: { rel: 'writing-job:test', action: 'draft', eventId: `source:${runId}` },
      birth: {
        schemaVersion: 1,
        kind: 'event-native',
        definition: {
          ref: 'writing-agent',
          version: 1,
          sourceHash: `sha256:${'1'.repeat(64)}`,
          parentHashes: [],
          flattenedHash: `sha256:${'2'.repeat(64)}`,
        },
        prompt: { templateHash: `sha256:${'3'.repeat(64)}`, compiledHash },
        runtime: {
          profileName: profile.name,
          profileVersion: '1',
          adapterVersion: 'document-agent-runtime@1',
        },
        taskContract: { ref: 'writing-agent@1:input', hash: `sha256:${'4'.repeat(64)}` },
        resultContract: { ref: 'writing-agent@1:output', hash: `sha256:${'5'.repeat(64)}` },
      },
      task: {
        schemaVersion: 1,
        contract: { ref: 'writing-agent@1:input', hash: `sha256:${'4'.repeat(64)}` },
        payload: {
          kind: 'writing-task',
          writingBrief: brief as unknown as AgentRunJson,
          compiledPrompt: { compiledHash, messages },
        },
      },
      limits: { maxSuspensions: 0 },
    };
    const create: AgentRunCommand = {
      kind: 'create',
      runId,
      commandId: `create:${runId}`,
      eventId: `event:create:${runId}`,
      principal: args.principal,
      policyScope: args.policyScope,
      source: args.source,
      birth: args.birth,
      task: args.task,
    };
    await appendAgentRunCommand(db, create);
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ui4a-t19-writing-adapter-'));
    let callbackCount = 0;
    const deps = {
      db,
      workspaceRoot,
      profiles: [profile],
      probe: async () => ({ available: true }),
      execute: async (input: CodexStructuredInput, ports: CodexStructuredDeps) => {
        const markdown = '# Architecture\n\nThe event log is authoritative. [S1]\n';
        const claim: WritingResult = {
          schemaVersion: 1,
          resultId: `result:${runId}`,
          status: 'completed',
          summary: 'Created a source-grounded document.',
          artifact: {
            path: 'out/article.md',
            hash: hash(markdown),
            sizeBytes: Buffer.byteLength(markdown),
            mediaType: 'text/markdown',
          },
          citations: [
            {
              sourceId: 'S1',
              sourceHash: brief.sources[0]!.hash,
              paragraphs: [1],
              claims: ['The event log is authoritative.'],
            },
          ],
          safety: {
            sourceInputsUnchanged: true,
            onlyAllowedOutputs: true,
            noRepositoryEffects: true,
            noNetworkEffects: true,
            noPublishEffects: true,
          },
        };
        await ports.onPromptDispatched?.({
          compiledHash: input.compiledHash,
          sentPromptHash: `sha256:${'6'.repeat(64)}`,
          messageCount: input.messages.length,
        });
        await ports.onRaw({ type: 'thread.started', thread_id: 'thread-writing' }, '1');
        await ports.onProgress({ kind: 'run-started', nativeSessionId: 'thread-writing' });
        await writeFile(join(input.workingDirectory, 'out', 'article.md'), markdown);
        await ports.onProgress({
          kind: 'command-started',
          commandId: 'cmd:wc',
          summary: 'wc -w out/article.md',
        });
        await ports.onProgress({ kind: 'command-completed', commandId: 'cmd:wc', exitCode: 0 });
        await ports.onProgress({ kind: 'files-changed', files: ['out/article.md'] });
        return { nativeSessionId: 'thread-writing', result: claim };
      },
      callback: async () => {
        callbackCount += 1;
      },
    };

    const prepared = await prepareWritingAgentRunWithDeps(args, deps);
    const execution = await executeWritingAgentRunWithDeps({ context: args, prepared }, deps, {
      attempt: 1,
      signal: new AbortController().signal,
      heartbeat: () => undefined,
    });
    if (execution.status !== 'completed')
      throw new Error('reason' in execution ? execution.reason : execution.status);
    const collected = await collectWritingAgentRunWithDeps(
      { context: args, prepared, execution },
      deps,
    );
    const verified = verifyWritingAgentRun({ context: args, collected });
    if (verified.status !== 'succeeded') throw new Error(verified.reason);
    await finalizeWritingAgentRunWithDeps(
      { context: args, outcome: verified, idempotencyKey: `finalize:${runId}` },
      deps,
    );

    expect((await getAgentRun(db, runId, args.principal, args.policyScope))?.status).toBe(
      'succeeded',
    );
    expect(verified.result.proposedEffects).toEqual([]);
    expect(verified.result.evidence.map((entry) => entry.kind)).toContain('markdown-render');
    expect(callbackCount).toBe(1);
  }, 30_000);
});
