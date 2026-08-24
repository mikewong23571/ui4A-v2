import { describe, expect, it, vi } from 'vitest';

import { runRunnerCommand, runRunnerMain, type RunnerCommandOptions } from './main.js';

function commandHarness(overrides: RunnerCommandOptions = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    options: {
      environment: {},
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
      ...overrides,
    } satisfies RunnerCommandOptions,
  };
}

describe('Agent Runner command entrypoint', () => {
  it('fails oneshot honestly with a structured unavailable result and exit 78', async () => {
    const harness = commandHarness();

    await expect(runRunnerMain(['oneshot'], harness.options)).resolves.toBe(78);
    expect(harness.stdout).toEqual([]);
    expect(harness.stderr).toHaveLength(1);
    expect(JSON.parse(harness.stderr[0]!)).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('Phase F'),
    });
  });

  it.each(['health', 'version', '--version'])(
    '%s exits zero with canonical non-GA metadata',
    async (command) => {
      const harness = commandHarness();

      await expect(runRunnerCommand(command, harness.options)).resolves.toBe(0);
      expect(harness.stderr).toEqual([]);
      const output = JSON.parse(harness.stdout[0]!) as Record<string, unknown>;
      const metadata = command === 'health' ? output.release : output;
      expect(metadata).toMatchObject({
        version: '0.1.0-experimental.1',
        channel: 'experimental',
        support: { ga: false, productionReady: false, sla: false, lts: false },
      });
    },
  );

  it('returns a structured non-zero failure for an unknown command', async () => {
    const harness = commandHarness();

    await expect(runRunnerCommand('not-a-command', harness.options)).resolves.toBe(1);
    expect(harness.stdout).toEqual([]);
    expect(JSON.parse(harness.stderr[0]!)).toEqual({
      status: 'failed',
      reason: 'unknown runner command: not-a-command',
    });
  });

  it('delegates daemon startup and returns zero only after it closes', async () => {
    const daemon = vi.fn(async () => undefined);
    const harness = commandHarness({ daemon });

    await expect(runRunnerMain([], harness.options)).resolves.toBe(0);
    expect(daemon).toHaveBeenCalledOnce();
    expect(daemon).toHaveBeenCalledWith(harness.options.environment);
  });

  it('reports daemon startup failure without a false success exit', async () => {
    const harness = commandHarness({
      daemon: async () => {
        throw new Error('bind failed');
      },
    });

    await expect(runRunnerCommand('daemon', harness.options)).resolves.toBe(1);
    expect(JSON.parse(harness.stderr[0]!)).toEqual({
      status: 'failed',
      reason: 'bind failed',
    });
  });
});
