import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { parseApplicationBundle } from '@ui4a/engine';

import secondArtifact from './test-fixtures/native-function-second.bundle.json';
import { prepareCapabilityDispatch } from '../engine/capability/dispatch';

describe('second Native Function Capability extension', () => {
  it('adds only a definition, deployment profile, and handler registration', async () => {
    const bundle = parseApplicationBundle(secondArtifact);
    const capability = bundle.capabilities[0]!;
    const profile = {
      schemaVersion: 1 as const,
      ref: 'reference-normalize-default',
      version: '1',
      executorClass: 'native-function' as const,
      handlerRef: 'reference/text-normalize@1',
      adapterVersion: 'native-function@1',
      availability: { status: 'available' as const },
      limits: {
        startToCloseTimeoutMs: 5_000,
        maximumAttempts: 2,
        inputBytes: 4096,
        outputBytes: 4096,
      },
      network: 'denied' as const,
    };
    const event = {
      kind: 'spawn-requested' as const,
      rel: 'reference-text:one',
      action: 'normalize',
      actor: 'human' as const,
      capability: capability.name,
      bind: {
        schemaVersion: 1,
        fields: { text: { from: 'source-field', name: 'text' } },
      },
      'on-done': 'normalized',
      'on-error': 'normalization-failed',
    };
    await expect(
      prepareCapabilityDispatch(
        {
          event,
          capability,
          principal: 'user:test',
          policyScope: 'reference',
          actionParams: {},
          source: {
            rel: event.rel,
            fields: { text: { value: '  one   two ', origin: 'default' } },
          },
          artifacts: {},
        },
        {
          prepareAgent: vi.fn(),
          nativeFunctionProfiles: new Map([[profile.ref, profile]]),
        },
      ),
    ).resolves.toMatchObject({ kind: 'native-function' });
    expect(
      readFileSync('apps/worker/src/capabilities/function/handlers/index.ts', 'utf8'),
    ).toContain(profile.handlerRef);
  });

  it('does not add capability or Application names to generic dispatcher/workstation code', () => {
    for (const path of [
      'apps/web/src/engine/capability/dispatch.ts',
      'apps/web/src/engine/service.ts',
      'apps/web/src/components/entity-view.tsx',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toContain('document.normalize');
      expect(source).not.toContain('cve.enrich');
      expect(source).not.toContain("=== 'security'");
    }
  });
});
