import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const workerRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(workerRoot, '../..');
const aliases = {
  '@ui4a/agent': resolve(repositoryRoot, 'packages/agent/src/index.ts'),
  '@ui4a/engine': resolve(repositoryRoot, 'packages/engine/src/index.ts'),
  '@ui4a/shared': resolve(repositoryRoot, 'packages/shared/src/index.ts'),
};

await rm(resolve(workerRoot, 'dist'), { force: true, recursive: true });

const common = {
  alias: aliases,
  bundle: true,
  external: ['@ai-sdk/openai', '@openai/codex-sdk', '@temporalio/*', 'ai', 'pg', 'zod'],
  format: 'esm',
  logLevel: 'info',
  platform: 'node',
  sourcemap: true,
  target: 'node24',
};

await build({
  ...common,
  entryPoints: [resolve(workerRoot, 'src/main.ts')],
  outfile: resolve(workerRoot, 'dist/main.js'),
});

await build({
  ...common,
  entryPoints: [resolve(workerRoot, 'src/workflows.ts')],
  outfile: resolve(workerRoot, 'dist/workflows.js'),
});

for (const [name, entryPoint] of Object.entries({
  't22-keycloak-realm-bootstrap': resolve(
    repositoryRoot,
    'scripts/t22-keycloak-realm-bootstrap.ts',
  ),
  't22-migrate': resolve(repositoryRoot, 'scripts/t22-migrate.ts'),
})) {
  await build({
    ...common,
    entryPoints: [entryPoint],
    outfile: resolve(workerRoot, `dist/${name}.js`),
  });
}
