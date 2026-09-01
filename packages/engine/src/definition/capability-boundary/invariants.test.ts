import { describe, expect, it } from 'vitest';

import type { CapabilityDefinition, FlowDefinition } from '@ui4a/shared';
import { seedGuardRegistry } from '@ui4a/shared';

import { validateDefinition } from '../invariants';

const registries = { guards: seedGuardRegistry };

function byName(checks: ReturnType<typeof validateDefinition>) {
  return Object.fromEntries(checks.map((check) => [check.name, check]));
}

describe('validateDefinition — Native Function boundary activation gate', () => {
  const capability: CapabilityDefinition = {
    name: 'cve.enrich',
    title: 'Enrich CVE',
    kind: 'extract',
    intent: 'Return structured reference impact data.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    executor: { class: 'native-function', profile: 'security-enrichment-default' },
  };
  const flow: FlowDefinition = {
    name: 'cve-enrichment',
    app: 'security',
    initial: 'identified',
    nodes: [
      {
        name: 'identified',
        actions: [
          {
            name: 'enrich-impact',
            title: 'Enrich',
            to: 'enriching',
            effect: {
              type: 'spawn',
              capability: 'cve.enrich',
              bind: {
                schemaVersion: 1,
                fields: { cveId: { from: 'source-field', name: 'cveId' } },
              },
              'on-done': 'enrichment-succeeded',
              'on-error': 'enrichment-failed',
            },
          },
        ],
      },
      {
        name: 'enriching',
        actions: [
          {
            name: 'enrichment-succeeded',
            title: 'Succeeded',
            to: 'enriched',
            internal: 'capability-callback',
            fields: [
              { name: 'executionId', type: 'text', persist: false },
              { name: 'result', type: 'json', persist: false },
              { name: 'receipt', type: 'json', persist: false },
            ],
          },
          {
            name: 'enrichment-failed',
            title: 'Failed',
            to: 'failed',
            internal: 'capability-callback',
            fields: [
              { name: 'executionId', type: 'text', persist: false },
              { name: 'failure', type: 'json', persist: false },
            ],
          },
        ],
      },
      { name: 'enriched', actions: [] },
      { name: 'failed', actions: [] },
    ],
  };

  function nativeRegistries(overrides: Record<string, unknown> = {}) {
    return {
      ...registries,
      applications: new Set(['security']),
      capabilities: new Set(['cve.enrich']),
      capabilityDefinitions: { 'cve.enrich': capability },
      executorProfiles: new Map([['security-enrichment-default', 'native-function']]),
      nativeFunctionProfiles: new Map([
        [
          'security-enrichment-default',
          {
            executorClass: 'native-function',
            handlerRef: 'security/cve-enrich@1',
            available: true,
          },
        ],
      ]),
      ...overrides,
    };
  }

  function executorCheck(
    candidate: FlowDefinition = flow,
    overrides: Record<string, unknown> = {},
  ) {
    return byName(validateDefinition(candidate, nativeRegistries(overrides) as never))[
      'executor-profile-valid'
    ];
  }

  it('accepts a bounded binding, available handler, and declared internal callbacks', () => {
    expect(executorCheck()).toEqual({ name: 'executor-profile-valid', pass: true });
  });

  it('rejects unavailable handlers and Agent Definition leakage into a Function executor', () => {
    expect(
      executorCheck(flow, {
        nativeFunctionProfiles: new Map([
          [
            'security-enrichment-default',
            {
              executorClass: 'native-function',
              handlerRef: 'security/cve-enrich@1',
              available: false,
            },
          ],
        ]),
      }).pass,
    ).toBe(false);
    expect(
      executorCheck(flow, {
        capabilityDefinitions: {
          'cve.enrich': {
            ...capability,
            executor: { ...capability.executor!, agentDefinition: 'coding-agent@1' },
          },
        },
      }).pass,
    ).toBe(false);
  });

  it('rejects missing, public, or schema-incompatible callbacks', () => {
    const missing = structuredClone(flow);
    missing.nodes[0]!.actions[0]!.effect = {
      ...(missing.nodes[0]!.actions[0]!.effect as object),
      'on-done': 'not-declared',
    } as never;
    expect(executorCheck(missing).pass).toBe(false);

    const exposed = structuredClone(flow);
    exposed.nodes[1]!.actions[0]!.internal = undefined;
    expect(executorCheck(exposed).pass).toBe(false);

    const incompatible = structuredClone(flow);
    incompatible.nodes[1]!.actions[0]!.fields = [
      { name: 'executionId', type: 'text', persist: false },
      { name: 'result', type: 'text', persist: false },
    ];
    expect(executorCheck(incompatible).pass).toBe(false);
  });

  it('rejects malformed bindings and absent Function schemas', () => {
    const malformed = structuredClone(flow);
    const effect = malformed.nodes[0]!.actions[0]!.effect as { bind?: Record<string, unknown> };
    effect.bind = { schemaVersion: 1, fields: { '*': { from: 'spread' } } };
    expect(executorCheck(malformed).pass).toBe(false);
    expect(
      executorCheck(flow, {
        capabilityDefinitions: {
          'cve.enrich': { ...capability, inputSchema: undefined },
        },
      }).pass,
    ).toBe(false);
  });

  it('keeps exact Agent Definition mandatory for non-Function executors', () => {
    expect(
      executorCheck(flow, {
        capabilityDefinitions: {
          'cve.enrich': {
            ...capability,
            executor: { class: 'coding-agent', profile: 'codex-default' },
          },
        },
        executorProfiles: new Map([['codex-default', 'coding-agent']]),
        nativeFunctionProfiles: new Map(),
      }).pass,
    ).toBe(false);
  });
});
