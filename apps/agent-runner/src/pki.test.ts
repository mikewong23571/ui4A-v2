import { createHash, X509Certificate } from 'node:crypto';
import {
  access,
  chmod,
  cp,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  initializeRunnerPki,
  type PkiProcessRunner,
  type RunnerPkiResult,
  RUNNER_PKI_FILES,
} from './pki.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ui4a-pki-test-'));
  temporaryRoots.push(root);
  return join(root, 'ca');
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function input(rootDirectory: string) {
  return {
    rootDirectory,
    ui4aHost: 'ui4a.mothership.internal',
    keycloakHost: 'auth.ui4a.mothership.internal',
    postgresHost: 'postgres.ui4a-system.svc.cluster.local',
    edgeUid: process.getuid!(),
    edgeGid: process.getgid!(),
  };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function materialHashes(rootDirectory: string): Promise<Record<string, string>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(RUNNER_PKI_FILES).map(async ([id, relativePath]) => [
        id,
        sha256(await readFile(join(rootDirectory, relativePath))),
      ]),
    ),
  );
}

// One real OpenSSL generation shared by every case that needs a complete inventory.
// Per-case scenarios (partial, invalid, mismatch, rebinding) are produced by copying
// this fixture and mutating the copy, never by regenerating with OpenSSL.
let sharedParent: string;
let sharedRoot: string;
let sharedResult: RunnerPkiResult;

beforeAll(async () => {
  sharedParent = await mkdtemp(join(tmpdir(), 'ui4a-pki-shared-'));
  sharedRoot = join(sharedParent, 'ca');
  sharedResult = await initializeRunnerPki(input(sharedRoot));
}, 30_000);

afterAll(async () => {
  await rm(sharedParent, { force: true, recursive: true });
});

async function copySharedInventory(): Promise<string> {
  const root = await temporaryRoot();
  await cp(sharedRoot, root, { recursive: true });
  for (const [id, relativePath] of Object.entries(RUNNER_PKI_FILES)) {
    await chmod(join(root, relativePath), id.endsWith('PrivateKey') ? 0o600 : 0o644);
  }
  return root;
}

describe('Agent Runner experimental PKI initializer', () => {
  it('uses system OpenSSL to create one root and three server leaf pairs', async () => {
    const rootDirectory = sharedRoot;
    const result = sharedResult;

    expect(result.status).toBe('created');
    expect(result.files).toHaveLength(8);
    const root = new X509Certificate(
      await readFile(join(rootDirectory, RUNNER_PKI_FILES.rootCertificate)),
    );
    expect(root.ca).toBe(true);
    for (const [id, host] of [
      ['ui4aCertificate', 'ui4a.mothership.internal'],
      ['keycloakCertificate', 'auth.ui4a.mothership.internal'],
    ] as const) {
      const leaf = new X509Certificate(await readFile(join(rootDirectory, RUNNER_PKI_FILES[id])));
      expect(leaf.subjectAltName).toBe(`DNS:${host}`);
      expect(leaf.checkHost(host)).toBe(host);
      expect(leaf.verify(root.publicKey)).toBe(true);
    }
    const postgres = new X509Certificate(
      await readFile(join(rootDirectory, RUNNER_PKI_FILES.postgresCertificate)),
    );
    expect(postgres.ca).toBe(false);
    expect(postgres.subject).toBe('CN=postgres.ui4a-system.svc.cluster.local');
    expect(postgres.subjectAltName).toBe(
      'DNS:postgres, DNS:postgres.ui4a-system.svc, DNS:postgres.ui4a-system.svc.cluster.local',
    );
    for (const host of [
      'postgres',
      'postgres.ui4a-system.svc',
      'postgres.ui4a-system.svc.cluster.local',
    ]) {
      expect(postgres.checkHost(host), host).toBe(host);
    }
    expect(postgres.verify(root.publicKey)).toBe(true);
    expect(result.postgresHandoff).toEqual({
      certificatePath: join(rootDirectory, 'postgres/server.crt'),
      privateKeyPath: join(rootDirectory, 'postgres/server.key'),
      certificateMode: 0o644,
      privateKeyMode: 0o600,
      ownership: 'deployment-adapter-copy-init',
    });
    for (const [id, relativePath] of Object.entries(RUNNER_PKI_FILES)) {
      await expect(access(join(rootDirectory, relativePath))).resolves.toBeUndefined();
      const mode = (await stat(join(rootDirectory, relativePath))).mode & 0o777;
      expect(mode, id).toBe(id.endsWith('PrivateKey') ? 0o600 : 0o644);
    }
    for (const id of [
      'ui4aCertificate',
      'ui4aPrivateKey',
      'keycloakCertificate',
      'keycloakPrivateKey',
    ] as const) {
      const owner = await stat(join(rootDirectory, RUNNER_PKI_FILES[id]));
      expect({ uid: owner.uid, gid: owner.gid }, id).toEqual({
        uid: process.getuid!(),
        gid: process.getgid!(),
      });
    }
  }, 30_000);

  it('reuses a complete valid inventory with zero process calls, writes, or byte changes', async () => {
    const rootDirectory = sharedRoot;
    const before = await materialHashes(rootDirectory);
    const processRunner = vi.fn<PkiProcessRunner>();

    const result = await initializeRunnerPki({ ...input(rootDirectory), processRunner });

    expect(result.status).toBe('reused');
    expect(processRunner).not.toHaveBeenCalled();
    expect(await materialHashes(rootDirectory)).toEqual(before);
  }, 30_000);

  it('fails closed for a partial inventory and does not regenerate missing material', async () => {
    const rootDirectory = await copySharedInventory();
    await unlink(join(rootDirectory, RUNNER_PKI_FILES.keycloakPrivateKey));
    const processRunner = vi.fn<PkiProcessRunner>();

    await expect(initializeRunnerPki({ ...input(rootDirectory), processRunner })).rejects.toThrow(
      'PKI_PARTIAL_STATE',
    );
    expect(processRunner).not.toHaveBeenCalled();
  }, 30_000);

  it('fails closed for a complete but invalid certificate inventory', async () => {
    const rootDirectory = await copySharedInventory();
    await writeFile(join(rootDirectory, RUNNER_PKI_FILES.ui4aCertificate), 'not-a-certificate', {
      mode: 0o644,
    });

    await expect(initializeRunnerPki(input(rootDirectory))).rejects.toThrow('PKI_INVALID');
  }, 30_000);

  it('rejects a PostgreSQL certificate and private-key mismatch without regeneration', async () => {
    const rootDirectory = await copySharedInventory();
    await writeFile(
      join(rootDirectory, RUNNER_PKI_FILES.postgresPrivateKey),
      await readFile(join(rootDirectory, RUNNER_PKI_FILES.keycloakPrivateKey)),
      { mode: 0o600 },
    );
    const processRunner = vi.fn<PkiProcessRunner>();

    await expect(initializeRunnerPki({ ...input(rootDirectory), processRunner })).rejects.toThrow(
      'PKI_INVALID',
    );
    expect(processRunner).not.toHaveBeenCalled();
  }, 30_000);

  it('uses an injected no-shell process runner and redacts its failure details', async () => {
    const rootDirectory = await temporaryRoot();
    const privateDetail = '__private_key_detail__';
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const processRunner: PkiProcessRunner = async (executable, args) => {
      calls.push({ executable, args });
      throw new Error(privateDetail);
    };

    let failure: Error | undefined;
    try {
      await initializeRunnerPki({ ...input(rootDirectory), processRunner });
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toBe('PKI_OPENSSL_FAILED');
    expect(failure?.message).not.toContain(privateDetail);
    expect(calls[0]?.executable).toBe('openssl');
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['genpkey', '-algorithm', 'RSA']));
    await expect(access(join(rootDirectory, '.ui4a-pki-complete.json'))).rejects.toThrow();
  });

  it('binds the complete marker and reusable inventory to the canonical PostgreSQL host', async () => {
    const rootDirectory = await copySharedInventory();
    const processRunner = vi.fn<PkiProcessRunner>();

    await expect(
      initializeRunnerPki({
        ...input(rootDirectory),
        postgresHost: 'postgres.other-system.svc.cluster.local',
        processRunner,
      }),
    ).rejects.toThrow('PKI_INVALID');
    expect(processRunner).not.toHaveBeenCalled();
  });

  it('treats a missing PostgreSQL private key as partial state without rotation', async () => {
    const rootDirectory = await copySharedInventory();
    await unlink(join(rootDirectory, RUNNER_PKI_FILES.postgresPrivateKey));
    const processRunner = vi.fn<PkiProcessRunner>();

    await expect(initializeRunnerPki({ ...input(rootDirectory), processRunner })).rejects.toThrow(
      'PKI_PARTIAL_STATE',
    );
    expect(processRunner).not.toHaveBeenCalled();
  });

  it('returns a stable non-secret error when the configured root is not writable', async () => {
    const parent = await temporaryRoot();
    await rm(parent, { force: true, recursive: true });
    await writeFile(parent, 'not-a-directory');

    await expect(initializeRunnerPki(input(parent))).rejects.toThrow('PKI_ROOT_NOT_WRITABLE');
  });
});
