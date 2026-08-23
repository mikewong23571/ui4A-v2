import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  WRITING_AGENT_LIMITS,
  assertWritingBrief,
  assertWritingResult,
  type WritingArtifact,
  type WritingBrief,
  type WritingContentHash,
  type WritingResult,
} from '@ui4a/shared';

const runFile = promisify(execFile);

export interface DocumentSourceManifestEntry {
  id: string;
  hash: WritingContentHash;
}

export interface DocumentWorkspaceHandle {
  schemaVersion: 1;
  workspaceId: string;
  workingDirectory: string;
  outputDirectory: string;
  sourceManifest: DocumentSourceManifestEntry[];
  allowedOutputPaths: string[];
}

export interface CollectedWritingArtifact extends WritingArtifact {
  content: string;
}

export interface CollectedDocumentWorkspace {
  artifact: CollectedWritingArtifact;
  changedPaths: string[];
  sourceManifest: DocumentSourceManifestEntry[];
}

export interface WritingVerificationEvidence {
  verifier:
    | 'writing-result-schema'
    | 'document-workspace'
    | 'source-integrity'
    | 'artifact-integrity'
    | 'citation-coverage'
    | 'markdown-render'
    | 'forbidden-writing-effects';
  passed: true;
  detail: string;
}

export interface VerifiedWritingOutput {
  evidence: WritingVerificationEvidence[];
  render: {
    mediaType: 'text/html';
    hash: WritingContentHash;
    sizeBytes: number;
  };
}

function contentHash(content: string | Uint8Array): WritingContentHash {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function assertWorkspaceRoot(workspaceRoot: string): void {
  if (!isAbsolute(workspaceRoot)) throw new Error('document workspace root must be absolute');
  const normalized = resolve(workspaceRoot);
  const home = process.env.HOME === undefined ? undefined : resolve(process.env.HOME);
  if (normalized === resolve('/') || normalized === home) {
    throw new Error('document workspace root is too broad');
  }
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(runId) || runId.includes('..')) {
    throw new Error('document workspace runId is unsafe');
  }
}

function assertSourceManifest(brief: WritingBrief): DocumentSourceManifestEntry[] {
  return brief.sources.map((source) => {
    const actual = contentHash(source.content);
    if (actual !== source.hash) throw new Error(`source ${source.id} hash does not match content`);
    return { id: source.id, hash: source.hash };
  });
}

/** Create a non-Git writable root containing only out/. Source bytes remain task data. */
export async function prepareDocumentWorkspace(
  input: { runId: string; brief: WritingBrief },
  deps: { workspaceRoot: string },
): Promise<DocumentWorkspaceHandle> {
  assertWorkspaceRoot(deps.workspaceRoot);
  assertRunId(input.runId);
  const brief = assertWritingBrief(input.brief);
  const sourceManifest = assertSourceManifest(brief);
  const runDirectory = join(resolve(deps.workspaceRoot), input.runId);
  const workingDirectory = join(runDirectory, 'agent');
  const outputDirectory = join(workingDirectory, 'out');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const entries = await readdir(workingDirectory);
  if (entries.some((entry) => entry !== 'out')) {
    throw new Error('document workspace contains state outside out/ before execution');
  }
  return {
    schemaVersion: 1,
    workspaceId: `document-workspace:${input.runId}`,
    workingDirectory,
    outputDirectory,
    sourceManifest,
    allowedOutputPaths: [...brief.allowedOutputPaths],
  };
}

async function workspaceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const workspacePath = relative(root, absolute).split(sep).join('/');
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('document workspace symlinks are forbidden');
      if (info.isDirectory()) {
        if (workspacePath !== 'out' && !workspacePath.startsWith('out/')) {
          throw new Error(`document workspace contains directory outside out/: ${workspacePath}`);
        }
        await visit(absolute);
      } else if (info.isFile()) {
        files.push(workspacePath);
      } else {
        throw new Error('document workspace contains an unsupported filesystem entry');
      }
    }
  };
  await visit(root);
  return files.sort();
}

/** Capture a claimed artifact only after enforcing the workspace and content-addressed contract. */
export async function collectDocumentWorkspace(input: {
  handle: DocumentWorkspaceHandle;
  brief: WritingBrief;
  claim: WritingResult;
}): Promise<CollectedDocumentWorkspace> {
  const brief = assertWritingBrief(input.brief);
  const claim = assertWritingResult(input.claim);
  const sourceManifest = assertSourceManifest(brief);
  if (JSON.stringify(sourceManifest) !== JSON.stringify(input.handle.sourceManifest)) {
    throw new Error('source manifest changed after workspace preparation');
  }
  const changedPaths = await workspaceFiles(input.handle.workingDirectory);
  const outsideOutput = changedPaths.find((path) => !path.startsWith('out/'));
  if (outsideOutput !== undefined) {
    throw new Error(`document workspace contains path outside out/: ${outsideOutput}`);
  }
  const undeclared = changedPaths.find((path) => !brief.allowedOutputPaths.includes(path));
  if (undeclared !== undefined)
    throw new Error(`document workspace output is not allowed: ${undeclared}`);
  if (!changedPaths.includes(claim.artifact.path))
    throw new Error('claimed writing artifact is missing');
  if (changedPaths.length !== 1)
    throw new Error('writing result must contain exactly one allowed artifact');
  const artifactPath = join(input.handle.workingDirectory, claim.artifact.path);
  const artifactBytes = await readFile(artifactPath);
  if (artifactBytes.byteLength > WRITING_AGENT_LIMITS.maxArtifactBytes) {
    throw new Error('writing artifact exceeds size limit');
  }
  const actualHash = contentHash(artifactBytes);
  if (actualHash !== claim.artifact.hash) throw new Error('writing artifact hash mismatch');
  if (artifactBytes.byteLength !== claim.artifact.sizeBytes) {
    throw new Error('writing artifact size mismatch');
  }
  return {
    artifact: { ...claim.artifact, content: artifactBytes.toString('utf8') },
    changedPaths,
    sourceManifest,
  };
}

function factualParagraphs(markdown: string): string[] {
  const withoutFences = markdown.replace(/```[\s\S]*?```/gu, '');
  return withoutFences
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(
      (paragraph) =>
        paragraph !== '' &&
        !paragraph.startsWith('#') &&
        !/^[-*_]{3,}$/u.test(paragraph) &&
        !/^\|(?:[^\n]*\|)+$/u.test(paragraph),
    );
}

function verifyCitations(brief: WritingBrief, result: WritingResult, markdown: string): void {
  const sources = new Map(brief.sources.map((source) => [source.id, source]));
  const paragraphs = factualParagraphs(markdown);
  const coverage = new Map<number, Set<string>>();
  for (const citation of result.citations) {
    const source = sources.get(citation.sourceId);
    if (source === undefined)
      throw new Error(`citation references unknown source ${citation.sourceId}`);
    if (source.hash !== citation.sourceHash)
      throw new Error(`citation source ${citation.sourceId} hash mismatch`);
    for (const paragraphNumber of citation.paragraphs) {
      const paragraph = paragraphs[paragraphNumber - 1];
      if (paragraph === undefined)
        throw new Error(`citation paragraph ${paragraphNumber} is missing`);
      if (!paragraph.includes(`[${citation.sourceId}]`)) {
        throw new Error(
          `citation paragraph ${paragraphNumber} lacks [${citation.sourceId}] marker`,
        );
      }
      const sourceIds = coverage.get(paragraphNumber) ?? new Set<string>();
      sourceIds.add(citation.sourceId);
      coverage.set(paragraphNumber, sourceIds);
    }
  }
  for (const [index, paragraph] of paragraphs.entries()) {
    const markers = [...paragraph.matchAll(/\[([A-Za-z][A-Za-z0-9_-]{0,63})\]/gu)].map(
      (match) => match[1]!,
    );
    if (brief.citationPolicy.requireEveryFactualParagraph && markers.length === 0) {
      throw new Error(`factual paragraph ${index + 1} has no source marker`);
    }
    for (const sourceId of markers) {
      if (!sources.has(sourceId))
        throw new Error(`paragraph ${index + 1} references unknown source ${sourceId}`);
      if (!coverage.get(index + 1)?.has(sourceId)) {
        throw new Error(
          `citation manifest does not cover paragraph ${index + 1} source ${sourceId}`,
        );
      }
    }
  }
}

const forbiddenCommand =
  /(?:^|[\s;&|])(git|curl|wget|ssh|scp|npm|pnpm|yarn|bun)(?:[\s;&|]|$)|\b(push|merge|deploy|publish|activate)\b/iu;

function verifyCommands(commands: string[]): void {
  const command = commands.find((candidate) => forbiddenCommand.test(candidate));
  if (command !== undefined) throw new Error(`forbidden writing effect observed: ${command}`);
}

async function renderMarkdown(markdown: string): Promise<VerifiedWritingOutput['render']> {
  const renderRoot = await mkdtemp(join(tmpdir(), 'ui4a-writing-render-'));
  const inputPath = join(renderRoot, 'input.md');
  const outputPath = join(renderRoot, 'output.html');
  const { writeFile } = await import('node:fs/promises');
  try {
    await writeFile(inputPath, markdown);
    await runFile(
      'pandoc',
      [
        '--from=gfm',
        '--to=html5',
        '--standalone',
        '--metadata',
        'title=UI4A Writing Artifact',
        inputPath,
        '-o',
        outputPath,
      ],
      {
        env: {
          PATH: process.env.PATH,
          LANG: 'C.UTF-8',
          NODE_ENV: process.env.NODE_ENV ?? 'test',
          SOURCE_DATE_EPOCH: '0',
        },
        timeout: 10_000,
      },
    );
    const rendered = await readFile(outputPath);
    return { mediaType: 'text/html', hash: contentHash(rendered), sizeBytes: rendered.byteLength };
  } catch (error) {
    throw new Error(
      `deterministic Markdown render failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await rm(renderRoot, { recursive: true, force: true });
  }
}

/** Independently verify one source-grounded Writing result. Provider safety claims are not evidence. */
export async function verifyWritingOutput(input: {
  brief: WritingBrief;
  claim: WritingResult;
  collected: CollectedDocumentWorkspace;
  observedCommands: string[];
}): Promise<VerifiedWritingOutput> {
  const brief = assertWritingBrief(input.brief);
  const claim = assertWritingResult(input.claim);
  assertSourceManifest(brief);
  if (input.collected.artifact.hash !== claim.artifact.hash)
    throw new Error('collected artifact hash mismatch');
  if (input.collected.artifact.path !== claim.artifact.path)
    throw new Error('collected artifact path mismatch');
  if (input.collected.changedPaths.some((path) => !brief.allowedOutputPaths.includes(path))) {
    throw new Error('document workspace contains an undeclared output');
  }
  verifyCitations(brief, claim, input.collected.artifact.content);
  verifyCommands(input.observedCommands);
  const render = await renderMarkdown(input.collected.artifact.content);
  return {
    evidence: [
      { verifier: 'writing-result-schema', passed: true, detail: 'WritingResult@1 parsed' },
      {
        verifier: 'document-workspace',
        passed: true,
        detail: 'only declared out/ artifact exists',
      },
      {
        verifier: 'source-integrity',
        passed: true,
        detail: 'task source hashes match immutable manifest',
      },
      {
        verifier: 'artifact-integrity',
        passed: true,
        detail: 'path, media type, size, and SHA-256 match',
      },
      {
        verifier: 'citation-coverage',
        passed: true,
        detail: 'paragraph markers resolve to manifest citations',
      },
      { verifier: 'markdown-render', passed: true, detail: render.hash },
      {
        verifier: 'forbidden-writing-effects',
        passed: true,
        detail: 'no repository, network, dependency, or publish commands',
      },
    ],
    render,
  };
}
