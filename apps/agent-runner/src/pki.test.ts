import { createHash, X509Certificate } from 'node:crypto';
import { access, chmod, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  initializeRunnerPki,
  type PkiProcessRunner,
  RUNNER_PKI_FILES,
} from './pki.js';

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ui4a-pki-test-'));
  temporaryRoots.push(root);
  return join(root, 'ca');
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function input(rootDirectory: string) {
  return {
    rootDirectory,
    ui4aHost: 'ui4a.mothership.internal',
    keycloakHost: 'auth.ui4a.mothership.internal',
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

describe('Agent Runner experimental PKI initializer', () => {
  it('uses system OpenSSL to create one root and two exact-host leaf pairs', async () => {
    const rootDirectory = await temporaryRoot();

    const result = await initializeRunnerPki(input(rootDirectory));

    expect(result.status).toBe('created');
    expect(result.files).toHaveLength(6);
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
    for (const [id, relativePath] of Object.entries(RUNNER_PKI_FILES)) {
      await expect(access(join(rootDirectory, relativePath))).resolves.toBeUndefined();
      const mode = (await stat(join(rootDirectory, relativePath))).mode & 0o777;
      expect(mode, id).toBe(id.endsWith('PrivateKey') ? 0o600 : 0o644);
    }
  }, 30_000);

  it('reuses a complete valid inventory with zero process calls, writes, or byte changes', async () => {
    const rootDirectory = await temporaryRoot();
    await initializeRunnerPki(input(rootDirectory));
    const before = await materialHashes(rootDirectory);
    const processRunner = vi.fn<PkiProcessRunner>();

    const result = await initializeRunnerPki({ ...input(rootDirectory), processRunner });

    expect(result.status).toBe('reused');
    expect(processRunner).not.toHaveBeenCalled();
    expect(await materialHashes(rootDirectory)).toEqual(before);
  }, 30_000);

  it('fails closed for a partial inventory and does not regenerate missing material', async () => {
    const rootDirectory = await temporaryRoot();
    await initializeRunnerPki(input(rootDirectory));
    await unlink(join(rootDirectory, RUNNER_PKI_FILES.keycloakPrivateKey));
    const processRunner = vi.fn<PkiProcessRunner>();

    await expect(
      initializeRunnerPki({ ...input(rootDirectory), processRunner }),
    ).rejects.toThrow('PKI_PARTIAL_STATE');
    expect(processRunner).not.toHaveBeenCalled();
  }, 30_000);

  it('fails closed for a complete but invalid certificate inventory', async () => {
    const rootDirectory = await temporaryRoot();
    await initializeRunnerPki(input(rootDirectory));
    await writeFile(
      join(rootDirectory, RUNNER_PKI_FILES.ui4aCertificate),
      'not-a-certificate',
      { mode: 0o644 },
    );

    await expect(initializeRunnerPki(input(rootDirectory))).rejects.toThrow('PKI_INVALID');
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

  it('returns a stable non-secret error when the configured root is not writable', async () => {
    const parent = await temporaryRoot();
    await rm(parent, { force: true, recursive: true });
    await writeFile(parent, 'not-a-directory');

    await expect(initializeRunnerPki(input(parent))).rejects.toThrow('PKI_ROOT_NOT_WRITABLE');
  });
});
