import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  bindCapabilityInput,
  parseCapabilityInputBinding,
  type CapabilityInputBindingV1,
} from './capability-input-binding';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['cveId', 'requestedBy'],
  properties: {
    cveId: { type: 'string' },
    requestedBy: { type: 'string' },
    evidence: { type: 'object' },
  },
};

const binding: CapabilityInputBindingV1 = {
  schemaVersion: 1,
  fields: {
    cveId: { from: 'source-field', name: 'cveId' },
    requestedBy: { from: 'action-param', name: 'requestedBy' },
  },
};

function bind(overrides: Record<string, unknown> = {}) {
  return bindCapabilityInput({
    binding,
    actionParams: { requestedBy: 'user:mike' },
    source: {
      rel: 'cve:CVE-2026-0001',
      fields: {
        cveId: { value: 'CVE-2026-0001', origin: 'default' },
        privateNote: { value: 'must-not-leak', origin: 'intent' },
      },
    },
    artifacts: {},
    inputSchema: schema,
    limits: { maxFields: 8, maxDepth: 6, maxNodes: 64, maxBytes: 4096 },
    ...overrides,
  });
}

describe('Capability input binding V1', () => {
  it('binds only declared action params and source fields with provenance', () => {
    const result = bind();
    expect(result.payload).toEqual({ cveId: 'CVE-2026-0001', requestedBy: 'user:mike' });
    expect(result.sources).toEqual({
      cveId: { from: 'source-field', name: 'cveId', rel: 'cve:CVE-2026-0001' },
      requestedBy: { from: 'action-param', name: 'requestedBy' },
    });
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('resolves one already-authorized artifact ref without granting arbitrary reads', () => {
    const result = bind({
      binding: {
        schemaVersion: 1,
        fields: {
          cveId: { from: 'source-field', name: 'cveId' },
          requestedBy: { from: 'action-param', name: 'requestedBy' },
          evidence: { from: 'artifact-ref', param: 'evidenceRef' },
        },
      },
      actionParams: { requestedBy: 'user:mike', evidenceRef: 'artifact:cve-catalog' },
      artifacts: {
        evidenceRef: { rel: 'artifact:cve-catalog', value: { catalog: 'reference-v1' } },
      },
    });
    expect(result.payload.evidence).toEqual({ catalog: 'reference-v1' });
    expect(result.sources.evidence).toEqual({
      from: 'artifact-ref',
      param: 'evidenceRef',
      rel: 'artifact:cve-catalog',
    });
  });

  it.each([
    ['missing action param', { actionParams: {} }],
    ['missing source field', { source: { rel: 'cve:CVE-2026-0001', fields: {} } }],
    [
      'unresolved artifact',
      {
        binding: {
          schemaVersion: 1,
          fields: {
            cveId: { from: 'source-field', name: 'cveId' },
            requestedBy: { from: 'action-param', name: 'requestedBy' },
            evidence: { from: 'artifact-ref', param: 'evidenceRef' },
          },
        },
        actionParams: { requestedBy: 'user:mike', evidenceRef: 'artifact:outside' },
      },
    ],
    ['schema mismatch', { actionParams: { requestedBy: 42 } }],
  ])('fails closed for %s', (_label, override) => {
    expect(() => bind(override)).toThrow();
  });

  it.each([
    ['wildcard destination', { '*': { from: 'action-param', name: 'requestedBy' } }],
    ['nested destination', { 'user.name': { from: 'action-param', name: 'requestedBy' } }],
    ['spread source', { requestedBy: { from: 'spread', name: 'requestedBy' } }],
    ['expression source', { requestedBy: { from: 'expression', value: '$.user' } }],
    [
      'unknown source key',
      { requestedBy: { from: 'action-param', name: 'requestedBy', fallback: 'system' } },
    ],
  ])('rejects %s', (_label, fields) => {
    expect(() => parseCapabilityInputBinding({ schemaVersion: 1, fields })).toThrow();
  });

  it('rejects excessive fields, depth, nodes, and UTF-8 bytes', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [
        `f${index}`,
        { from: 'action-param', name: 'requestedBy' },
      ]),
    );
    expect(() => parseCapabilityInputBinding({ schemaVersion: 1, fields: tooMany })).toThrow();
    expect(() =>
      bind({
        actionParams: { requestedBy: { a: { b: { c: { d: { e: 'deep' } } } } } },
      }),
    ).toThrow(/depth|schema/i);
    expect(() => bind({ actionParams: { requestedBy: 'x'.repeat(5000) } })).toThrow(
      /bytes|schema/i,
    );
  });

  it('never includes unbound source fields', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.jsonValue()),
        (extra) => {
          const safeExtra = Object.fromEntries(
            Object.entries(extra)
              .filter(([key]) => key !== 'cveId')
              .map(([key, value]) => [key, { value, origin: 'effect' as const }]),
          );
          const result = bind({
            source: {
              rel: 'cve:CVE-2026-0001',
              fields: {
                cveId: { value: 'CVE-2026-0001', origin: 'default' },
                ...safeExtra,
              },
            },
          });
          expect(Object.keys(result.payload).sort()).toEqual(['cveId', 'requestedBy']);
        },
      ),
      { numRuns: 100 },
    );
  });
});
