import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/t22-*.test.ts'],
    environment: 'node',
  },
});
