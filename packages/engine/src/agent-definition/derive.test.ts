import { describe, expect, it } from 'vitest';

import type { AgentDefinitionRef, DerivedAgentDefinitionSource } from '@ui4a/shared';

import {
  AgentDefinitionDerivationError,
  resolveAgentDefinition,
  type AgentDefinitionSourceRegistry,
} from './derive';
import { childDefinition, rootDefinition } from './fixtures.test-helper';

function registry(
  entries: [
    AgentDefinitionRef,
    AgentDefinitionSourceRegistry extends ReadonlyMap<AgentDefinitionRef, infer V> ? V : never,
  ][],
): AgentDefinitionSourceRegistry {
  return new Map(entries);
}

describe('Agent Definition exact-parent derivation', () => {
  it('flattens one exact active parent and records immutable birth provenance', () => {
    const parent = rootDefinition();
    const child = childDefinition();
    const artifact = resolveAgentDefinition(
      child,
      registry([[parent.ref, { status: 'active', source: parent }]]),
    );

    expect(artifact.definition.ref).toBe('writing-agent@1');
    expect(artifact.definition.intent).toBe('Write an evidence-backed document');
    expect(artifact.definition.prompt.blocks.map((block) => block.id)).toEqual([
      'authority',
      'objective',
      'writing-method',
    ]);
    expect(artifact.derivedFrom).toEqual({
      ref: 'base-agent@1',
      flattenedHash: resolveAgentDefinition(parent, new Map()).flattenedHash,
    });
    expect(artifact.flattenedHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('does not change an existing child when a newer parent becomes active', () => {
    const parent1 = rootDefinition();
    const child = childDefinition();
    const firstRegistry = registry([[parent1.ref, { status: 'active', source: parent1 }]]);
    const born = resolveAgentDefinition(child, firstRegistry);
    const parent2 = rootDefinition({ ref: 'base-agent@2', version: 2, intent: 'Changed parent' });
    const later = resolveAgentDefinition(
      child,
      registry([
        [parent1.ref, { status: 'active', source: parent1 }],
        [parent2.ref, { status: 'active', source: parent2 }],
      ]),
    );
    expect(later).toEqual(born);
  });

  it('rejects missing, inactive, cyclic, duplicate-block, and forbidden override cases', () => {
    expect(() => resolveAgentDefinition(childDefinition(), new Map())).toThrowError(
      AgentDefinitionDerivationError,
    );
    const parent = rootDefinition();
    expect(() =>
      resolveAgentDefinition(
        childDefinition(),
        registry([[parent.ref, { status: 'draft', source: parent }]]),
      ),
    ).toThrow(/not active/);
    expect(() =>
      resolveAgentDefinition(
        childDefinition(),
        registry([
          [
            parent.ref,
            {
              status: 'active',
              source: rootDefinition({ ref: 'other-agent@1', name: 'other-agent' }),
            },
          ],
        ]),
      ),
    ).toThrow(/registry key base-agent@1 contains other-agent@1/);

    const a: DerivedAgentDefinitionSource = {
      ...childDefinition(),
      ref: 'a-agent@1',
      name: 'a-agent',
      extends: 'b-agent@1',
    };
    const b: DerivedAgentDefinitionSource = {
      ...childDefinition(),
      ref: 'b-agent@1',
      name: 'b-agent',
      extends: 'a-agent@1',
    };
    expect(() =>
      resolveAgentDefinition(
        a,
        registry([
          [a.ref, { status: 'active', source: a }],
          [b.ref, { status: 'active', source: b }],
        ]),
      ),
    ).toThrow(/a-agent@1 -> b-agent@1 -> a-agent@1/);

    const duplicate = childDefinition({
      specialize: {
        replace: {},
        appendPromptBlocks: [
          { id: 'authority', role: 'system', purpose: 'instruction', literal: 'Replace authority' },
        ],
      },
    });
    expect(() =>
      resolveAgentDefinition(
        duplicate,
        registry([[parent.ref, { status: 'active', source: parent }]]),
      ),
    ).toThrow(/already exists/);
    expect(() =>
      resolveAgentDefinition(
        {
          ...childDefinition(),
          specialize: { replace: { prompt: {} } as never, appendPromptBlocks: [] },
        },
        registry([[parent.ref, { status: 'active', source: parent }]]),
      ),
    ).toThrow(/unknown field "prompt"/);
  });

  it('replays generated single-parent lineages deterministically', () => {
    for (let length = 1; length <= 20; length += 1) {
      const parent = rootDefinition();
      const sources = new Map<
        AgentDefinitionRef,
        {
          status: 'active';
          source: ReturnType<typeof rootDefinition> | DerivedAgentDefinitionSource;
        }
      >([[parent.ref, { status: 'active', source: parent }]]);
      let current: DerivedAgentDefinitionSource = childDefinition();
      for (let index = 1; index < length; index += 1) {
        sources.set(current.ref, { status: 'active', source: current });
        current = childDefinition({
          ref: `writing-agent-${index}@1`,
          name: `writing-agent-${index}`,
          extends: current.ref,
          specialize: {
            replace: { intent: `Lineage ${index}` },
            appendPromptBlocks: [
              {
                id: `method-${index}`,
                role: 'system',
                purpose: 'instruction',
                literal: `Step ${index}`,
              },
            ],
          },
        });
      }
      const first = resolveAgentDefinition(current, sources);
      const replay = resolveAgentDefinition(current, new Map([...sources].reverse()));
      expect(replay.flattenedHash).toBe(first.flattenedHash);
      expect(replay.definition.prompt.blocks).toHaveLength(length + 2);
    }
  });
});
