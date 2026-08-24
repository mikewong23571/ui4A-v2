import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const runnerRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(runnerRoot, '../..');

await rm(resolve(runnerRoot, 'dist'), { force: true, recursive: true });
await build({
  alias: {
    '@ui4a/shared': resolve(repositoryRoot, 'packages/shared/src/index.ts'),
  },
  bundle: true,
  entryPoints: [resolve(runnerRoot, 'src/main.ts')],
  external: ['@openai/codex-sdk'],
  format: 'esm',
  logLevel: 'info',
  outfile: resolve(runnerRoot, 'dist/main.js'),
  platform: 'node',
  sourcemap: true,
  target: 'node24',
});
