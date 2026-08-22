import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const variableNames = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loader = resolve(repositoryRoot, 'scripts/with-local-env.mjs');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ui4a-dev-env-'));
const envFile = join(temporaryDirectory, 'verification.env');

const probe = `
  const names = ${JSON.stringify(variableNames)};
  if (names.some((name) => !process.env[name])) process.exit(1);
  if (process.env.LLM_MODEL !== 'external-verification') process.exit(1);
  console.log(process.argv[1] + ': inherited ' + names.join(', '));
`;

function verifyProcess(role) {
  return new Promise((resolvePromise, rejectPromise) => {
    const probeEnvironment = { ...process.env };
    for (const name of variableNames) delete probeEnvironment[name];
    probeEnvironment.LLM_MODEL = 'external-verification';

    const child = spawn(
      process.execPath,
      [loader, `--env-file=${envFile}`, process.execPath, '-e', probe, role],
      { env: probeEnvironment, stdio: 'inherit' },
    );

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${role} environment probe exited with code ${code}`));
      }
    });
  });
}

try {
  await writeFile(
    envFile,
    variableNames.map((name, index) => `${name}=verification-${index}`).join('\n'),
    { mode: 0o600 },
  );
  await Promise.all([verifyProcess('web'), verifyProcess('worker')]);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
