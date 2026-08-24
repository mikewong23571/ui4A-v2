import { describe, expect, it, vi } from 'vitest';

type Sha256 = `sha256:${string}`;
type PortableOperationKind = 'git-bundle' | 'tracked-patch' | 'untracked-archive';

interface CodingWorkspaceInput {
  runId: string;
  archiveStrategy: 'portable-git';
  repositoryRef: string;
  baseSha: string;
  branch: string;
  mainCheckoutFingerprint: Sha256;
  allowedUntrackedPaths: string[];
  untrackedPaths: string[];
}

interface PortableOperation {
  kind: PortableOperationKind;
  output: 'base.bundle' | 'tracked.patch' | 'untracked.tar';
  baseSha?: string;
  paths?: string[];
}

interface CodingWorkspaceArchivePlan {
  schemaVersion: 1;
  strategy: 'portable-git';
  operations: PortableOperation[];
}

interface CapturedArtifact {
  sha256: Sha256;
  sizeBytes: number;
  mode: number;
}

interface CodingWorkspaceManifest extends CodingWorkspaceArchivePlan {
  kind: 'coding-workspace';
  runId: string;
  repositoryRef: string;
  baseSha: string;
  branch: string;
  mainCheckoutFingerprint: Sha256;
  artifacts: Array<
    CapturedArtifact & {
      kind: 'base-bundle' | 'tracked-patch' | 'untracked-archive';
      path: 'base.bundle' | 'tracked.patch' | 'untracked.tar';
    }
  >;
}

interface RunWorkspaceEntry {
  path: string;
  type: 'regular-file' | 'directory' | 'symlink' | 'device' | 'fifo' | 'socket';
  sha256: Sha256;
  sizeBytes: number;
  mode: number;
}

interface RunWorkspaceManifest {
  schemaVersion: 1;
  kind: 'run-workspace';
  specialization: 'writing' | 'authoring';
  runId: string;
  entries: Array<RunWorkspaceEntry & { type: 'regular-file' | 'directory' }>;
}

interface WorkspaceManifestModule {
  planCodingWorkspaceArchive(input: CodingWorkspaceInput): CodingWorkspaceArchivePlan;
  createCodingWorkspaceManifest(
    input: CodingWorkspaceInput,
    executor: { capture(operation: PortableOperation): Promise<CapturedArtifact> },
  ): Promise<CodingWorkspaceManifest>;
  createRunWorkspaceManifest(input: {
    specialization: 'writing' | 'authoring';
    runId: string;
    entries: RunWorkspaceEntry[];
  }): RunWorkspaceManifest;
}

const plannedModulePath = './workspace-manifest';
const SHA_A = `sha256:${'a'.repeat(64)}` as const;
const SHA_B = `sha256:${'b'.repeat(64)}` as const;
const BASE_SHA = 'a'.repeat(40);

async function plannedApi(): Promise<WorkspaceManifestModule> {
  return (await import(plannedModulePath)) as WorkspaceManifestModule;
}

function codingInput(overrides: Partial<CodingWorkspaceInput> = {}): CodingWorkspaceInput {
  return {
    runId: 'agent-run-42',
    archiveStrategy: 'portable-git',
    repositoryRef: 'ui4a-main',
    baseSha: BASE_SHA,
    branch: 'ui4a/run-agent-run-42',
    mainCheckoutFingerprint: SHA_A,
    allowedUntrackedPaths: ['artifacts', 'reports'],
    untrackedPaths: ['reports/test.json', 'artifacts/result.md'],
    ...overrides,
  };
}

describe('T22 portable Coding workspace recovery contract', () => {
  it('plans deterministic portable Git evidence without archiving a linked worktree', async () => {
    const { planCodingWorkspaceArchive } = await plannedApi();

    const plan = planCodingWorkspaceArchive(codingInput());

    expect(plan).toEqual({
      schemaVersion: 1,
      strategy: 'portable-git',
      operations: [
        { kind: 'git-bundle', output: 'base.bundle', baseSha: BASE_SHA },
        { kind: 'tracked-patch', output: 'tracked.patch', baseSha: BASE_SHA },
        {
          kind: 'untracked-archive',
          output: 'untracked.tar',
          paths: ['artifacts/result.md', 'reports/test.json'],
        },
      ],
    });
    expect(JSON.stringify(plan)).not.toContain('workspacePath');
    expect(JSON.stringify(plan.operations)).not.toContain('direct-tar');
  });

  it('rejects direct tar and unallowlisted or unsafe untracked paths', async () => {
    const { planCodingWorkspaceArchive } = await plannedApi();

    expect(() =>
      planCodingWorkspaceArchive(
        codingInput({ archiveStrategy: 'direct-tar' as CodingWorkspaceInput['archiveStrategy'] }),
      ),
    ).toThrow(expect.objectContaining({ code: 'WORKSPACE_DIRECT_ARCHIVE_FORBIDDEN' }));
    expect(() =>
      planCodingWorkspaceArchive(codingInput({ untrackedPaths: ['private/key.pem'] })),
    ).toThrow(expect.objectContaining({ code: 'WORKSPACE_PATH_NOT_ALLOWED' }));
    expect(() =>
      planCodingWorkspaceArchive(codingInput({ untrackedPaths: ['reports/../../secret'] })),
    ).toThrow(expect.objectContaining({ code: 'WORKSPACE_PATH_UNSAFE' }));
  });

  it('builds a deterministic manifest from injected artifact evidence', async () => {
    const { createCodingWorkspaceManifest } = await plannedApi();
    const capture = vi.fn(async (operation: PortableOperation): Promise<CapturedArtifact> => ({
      sha256: operation.kind === 'git-bundle' ? SHA_A : SHA_B,
      sizeBytes: operation.kind === 'git-bundle' ? 4096 : 512,
      mode: 0o600,
    }));

    const first = await createCodingWorkspaceManifest(codingInput(), { capture });
    const second = await createCodingWorkspaceManifest(codingInput(), { capture });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      kind: 'coding-workspace',
      strategy: 'portable-git',
      runId: 'agent-run-42',
      repositoryRef: 'ui4a-main',
      baseSha: BASE_SHA,
      branch: 'ui4a/run-agent-run-42',
      mainCheckoutFingerprint: SHA_A,
      artifacts: [
        { kind: 'base-bundle', path: 'base.bundle', sha256: SHA_A, sizeBytes: 4096, mode: 0o600 },
        {
          kind: 'tracked-patch',
          path: 'tracked.patch',
          sha256: SHA_B,
          sizeBytes: 512,
          mode: 0o600,
        },
        {
          kind: 'untracked-archive',
          path: 'untracked.tar',
          sha256: SHA_B,
          sizeBytes: 512,
          mode: 0o600,
        },
      ],
    });
    expect(capture).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['digest', { sha256: 'sha256:not-a-digest', sizeBytes: 1, mode: 0o600 }],
    ['size', { sha256: SHA_A, sizeBytes: -1, mode: 0o600 }],
    ['mode', { sha256: SHA_A, sizeBytes: 1, mode: 0o10000 }],
  ])('rejects invalid injected artifact %s evidence', async (_case, evidence) => {
    const { createCodingWorkspaceManifest } = await plannedApi();

    await expect(
      createCodingWorkspaceManifest(codingInput(), {
        capture: async () => evidence as CapturedArtifact,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'WORKSPACE_ARTIFACT_INVALID' }));
  });
});

describe('T22 Writing and Authoring run workspace recovery contract', () => {
  it.each(['writing', 'authoring'] as const)(
    'creates a deterministic, path-sorted %s inventory with file metadata only',
    async (specialization) => {
      const { createRunWorkspaceManifest } = await plannedApi();
      const entries: RunWorkspaceEntry[] = [
        {
          path: 'out/result.md',
          type: 'regular-file',
          sha256: SHA_B,
          sizeBytes: 42,
          mode: 0o600,
        },
        { path: 'out', type: 'directory', sha256: SHA_A, sizeBytes: 0, mode: 0o700 },
      ];

      expect(
        createRunWorkspaceManifest({ specialization, runId: 'agent-run-42', entries }),
      ).toEqual({
        schemaVersion: 1,
        kind: 'run-workspace',
        specialization,
        runId: 'agent-run-42',
        entries: [entries[1], entries[0]],
      });
    },
  );

  it.each(['symlink', 'device', 'fifo', 'socket'] as const)(
    'rejects unsupported %s entries',
    async (type) => {
      const { createRunWorkspaceManifest } = await plannedApi();

      expect(() =>
        createRunWorkspaceManifest({
          specialization: 'writing',
          runId: 'agent-run-42',
          entries: [{ path: 'out/unsafe', type, sha256: SHA_A, sizeBytes: 0, mode: 0o600 }],
        }),
      ).toThrow(expect.objectContaining({ code: 'WORKSPACE_ENTRY_TYPE_UNSAFE' }));
    },
  );

  it.each(['/etc/passwd', '../secret', 'out/../../secret', 'C:\\secret', 'out\\secret'])(
    'rejects absolute, traversal, or non-portable path %s',
    async (path) => {
      const { createRunWorkspaceManifest } = await plannedApi();

      expect(() =>
        createRunWorkspaceManifest({
          specialization: 'authoring',
          runId: 'agent-run-42',
          entries: [{ path, type: 'regular-file', sha256: SHA_A, sizeBytes: 1, mode: 0o600 }],
        }),
      ).toThrow(expect.objectContaining({ code: 'WORKSPACE_PATH_UNSAFE' }));
    },
  );

  it('does not serialize undeclared Prompt or Secret material', async () => {
    const { createRunWorkspaceManifest } = await plannedApi();
    const sentinel = '__prompt_and_secret_material__';
    const input = {
      specialization: 'writing' as const,
      runId: 'agent-run-42',
      entries: [
        {
          path: 'out/result.md',
          type: 'regular-file' as const,
          sha256: SHA_A,
          sizeBytes: 1,
          mode: 0o600,
        },
      ],
      prompt: sentinel,
      secret: sentinel,
      workspaceRoot: `/private/${sentinel}`,
    };

    const manifest = createRunWorkspaceManifest(input);

    expect(JSON.stringify(manifest)).not.toContain(sentinel);
    expect(manifest).not.toHaveProperty('prompt');
    expect(manifest).not.toHaveProperty('secret');
    expect(manifest).not.toHaveProperty('workspaceRoot');
  });
});
