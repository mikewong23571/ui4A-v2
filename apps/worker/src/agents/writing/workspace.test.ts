import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { WritingBrief, WritingResult } from '@ui4a/shared';

import {
  collectDocumentWorkspace,
  prepareDocumentWorkspace,
  verifyWritingOutput,
} from './workspace';

const hash = (value: string): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const sourceContent = 'Business truth is appended to the event log.\n';
const brief: WritingBrief = {
  schemaVersion: 1,
  objective: 'Write a short architecture note.',
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
      content: sourceContent,
      hash: hash(sourceContent),
    },
  ],
  citationPolicy: { style: 'paragraph-markers', requireEveryFactualParagraph: true },
  budget: {
    timeoutSeconds: 120,
    maxTurns: 10,
    maxRawEvents: 100,
    maxRawBytes: 100_000,
    maxRawChunkBytes: 10_000,
  },
};

describe('document-workspace', () => {
  it('exposes only an empty out/ writable root and keeps source content in the task manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ui4a-writing-workspace-'));
    const prepared = await prepareDocumentWorkspace(
      { runId: 'agent-run-1', brief },
      { workspaceRoot: root },
    );

    expect(prepared.workingDirectory).toBe(join(root, 'agent-run-1', 'agent'));
    expect(prepared.outputDirectory).toBe(join(prepared.workingDirectory, 'out'));
    expect(prepared.sourceManifest).toEqual([{ id: 'S1', hash: brief.sources[0]!.hash }]);
    await expect(
      readFile(join(prepared.workingDirectory, 'sources', 'S1'), 'utf8'),
    ).rejects.toThrow();
  });

  it('collects one allowed Markdown artifact and independently checks hash, citations, render, and effects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ui4a-writing-workspace-'));
    const prepared = await prepareDocumentWorkspace(
      { runId: 'agent-run-2', brief },
      { workspaceRoot: root },
    );
    const markdown = '# Architecture\n\nBusiness truth is appended to the event log. [S1]\n';
    await writeFile(join(prepared.workingDirectory, 'out', 'article.md'), markdown);
    const claim: WritingResult = {
      schemaVersion: 1,
      resultId: 'writing-result:2',
      status: 'completed',
      summary: 'Wrote the architecture note.',
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
          claims: ['Business truth is appended to the event log.'],
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

    const collected = await collectDocumentWorkspace({ handle: prepared, brief, claim });
    const verified = await verifyWritingOutput({
      brief,
      claim,
      collected,
      observedCommands: ['wc -w out/article.md', 'shasum -a 256 out/article.md'],
    });

    expect(collected.artifact).toMatchObject({ path: 'out/article.md', hash: hash(markdown) });
    expect(verified.evidence.every((entry) => entry.passed)).toBe(true);
    expect(verified.render).toMatchObject({ mediaType: 'text/html' });
    expect(verified.render.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejects source hash drift before workspace creation and any output escape or unsafe command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ui4a-writing-workspace-'));
    await expect(
      prepareDocumentWorkspace(
        {
          runId: 'agent-run-bad-source',
          brief: {
            ...brief,
            sources: [{ ...brief.sources[0]!, content: 'tampered' }],
          },
        },
        { workspaceRoot: root },
      ),
    ).rejects.toThrow(/source S1 hash/i);

    const prepared = await prepareDocumentWorkspace(
      { runId: 'agent-run-escape', brief },
      { workspaceRoot: root },
    );
    await mkdir(join(prepared.workingDirectory, 'empty-escape'));
    await expect(
      collectDocumentWorkspace({
        handle: prepared,
        brief,
        claim: {
          schemaVersion: 1,
          resultId: 'empty-escape',
          status: 'completed',
          summary: 'bad',
          artifact: {
            path: 'out/article.md',
            hash: `sha256:${'0'.repeat(64)}`,
            sizeBytes: 1,
            mediaType: 'text/markdown',
          },
          citations: [],
          safety: {
            sourceInputsUnchanged: true,
            onlyAllowedOutputs: true,
            noRepositoryEffects: true,
            noNetworkEffects: true,
            noPublishEffects: true,
          },
        },
      }),
    ).rejects.toThrow(/outside out/i);
    await writeFile(join(prepared.workingDirectory, 'notes.md'), 'escape');
    await expect(
      collectDocumentWorkspace({
        handle: prepared,
        brief,
        claim: {
          schemaVersion: 1,
          resultId: 'bad',
          status: 'completed',
          summary: 'bad',
          artifact: {
            path: 'out/article.md',
            hash: `sha256:${'0'.repeat(64)}`,
            sizeBytes: 1,
            mediaType: 'text/markdown',
          },
          citations: [],
          safety: {
            sourceInputsUnchanged: true,
            onlyAllowedOutputs: true,
            noRepositoryEffects: true,
            noNetworkEffects: true,
            noPublishEffects: true,
          },
        },
      }),
    ).rejects.toThrow(/outside out/i);

    await mkdir(join(prepared.workingDirectory, 'out'), { recursive: true });
    await writeFile(join(prepared.workingDirectory, 'out', 'article.md'), 'A fact. [S1]\n');
    await expect(
      verifyWritingOutput({
        brief,
        claim: {
          schemaVersion: 1,
          resultId: 'bad-effects',
          status: 'completed',
          summary: 'bad',
          artifact: {
            path: 'out/article.md',
            hash: hash('A fact. [S1]\n'),
            sizeBytes: Buffer.byteLength('A fact. [S1]\n'),
            mediaType: 'text/markdown',
          },
          citations: [
            {
              sourceId: 'S1',
              sourceHash: brief.sources[0]!.hash,
              paragraphs: [1],
              claims: ['A fact.'],
            },
          ],
          safety: {
            sourceInputsUnchanged: true,
            onlyAllowedOutputs: true,
            noRepositoryEffects: true,
            noNetworkEffects: true,
            noPublishEffects: true,
          },
        },
        collected: {
          artifact: {
            path: 'out/article.md',
            hash: hash('A fact. [S1]\n'),
            sizeBytes: Buffer.byteLength('A fact. [S1]\n'),
            mediaType: 'text/markdown',
            content: 'A fact. [S1]\n',
          },
          changedPaths: ['out/article.md'],
          sourceManifest: prepared.sourceManifest,
        },
        observedCommands: ['git status', 'curl https://example.com', 'ui4a publish'],
      }),
    ).rejects.toThrow(/forbidden writing effect/i);
  });
});
