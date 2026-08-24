import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/t22-evidence-contract.test.ts'],
    environment: 'node',
  },
});
