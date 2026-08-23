import { describe, expect, it } from 'vitest';

import { canonicalAgentJson, hashCanonicalAgentJson, parseAgentDefinitionSource } from './parse';
import { childDefinition, rootDefinition } from './fixtures.test-helper';

describe('Agent Definition parsing and canonicalization', () => {
  it('strictly parses roots and closed derivation patches', () => {
    expect(parseAgentDefinitionSource(rootDefinition())).toEqual(rootDefinition());
    expect(parseAgentDefinitionSource(childDefinition())).toEqual(childDefinition());
    expect(() => parseAgentDefinitionSource({ ...rootDefinition(), provider: 'codex' })).toThrow(
      /unknown field/,
    );
    expect(() =>
      parseAgentDefinitionSource(
        childDefinition({
          specialize: { replace: { prompt: {} } as never, appendPromptBlocks: [] },
        }),
      ),
    ).toThrow(/unknown field "prompt"/);
  });

  it('rejects malformed bindings, hidden variables, non-JSON values, and hard limits', () => {
    const root = rootDefinition();
    expect(() =>
      parseAgentDefinitionSource({
        ...root,
        prompt: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'task',
              role: 'user',
              purpose: 'task-data',
              binding: {
                source: 'task',
                pointer: 'objective',
                encoding: 'json-delimited',
                required: true,
              },
            },
          ],
        },
      }),
    ).toThrow(/RFC 6901/);
    expect(() =>
      parseAgentDefinitionSource({
        ...root,
        prompt: {
          schemaVersion: 1,
          blocks: [
            { id: 'bad', role: 'system', purpose: 'instruction', literal: 'Use {{objective}}' },
          ],
        },
      }),
    ).toThrow(/interpolation/);
    expect(() =>
      parseAgentDefinitionSource({
        ...root,
        contracts: { ...root.contracts, inputSchema: { bad: Infinity } },
      }),
    ).toThrow(/non-finite/);
    let deep: Record<string, unknown> = {};
    for (let index = 0; index < 40; index += 1) deep = { next: deep };
    expect(() =>
      parseAgentDefinitionSource({ ...root, contracts: { ...root.contracts, inputSchema: deep } }),
    ).toThrow(/maximum depth/);
  });

  it('sorts object keys, preserves arrays, and computes actual stable SHA-256', () => {
    expect(canonicalAgentJson({ z: 1, a: { d: 2, b: 1 } })).toBe('{"a":{"b":1,"d":2},"z":1}');
    expect(hashCanonicalAgentJson({ b: 2, a: 1 })).toBe(hashCanonicalAgentJson({ a: 1, b: 2 }));
    expect(hashCanonicalAgentJson({ values: [1, 2] })).not.toBe(
      hashCanonicalAgentJson({ values: [2, 1] }),
    );
    expect(hashCanonicalAgentJson({ a: 1 })).toBe(
      'sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
    );
  });

  it('keeps canonical identity stable across generated key insertion orders', () => {
    let seed = 0x12345678;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const entries = [
        ['a', iteration],
        ['b', `v-${iteration}`],
        ['c', iteration % 2 === 0],
      ] as const;
      const shuffled = [...entries].sort(() => random() - 0.5);
      const value = Object.fromEntries(shuffled);
      expect(hashCanonicalAgentJson(value)).toBe(
        hashCanonicalAgentJson({ a: iteration, b: `v-${iteration}`, c: iteration % 2 === 0 }),
      );
    }
  });
});
