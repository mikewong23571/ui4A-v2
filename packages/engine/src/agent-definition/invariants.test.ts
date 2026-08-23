import { describe, expect, it } from 'vitest';

import type { AgentDefinitionRef } from '@ui4a/shared';

import type { AgentDefinitionSourceRegistry } from './derive';
import { childDefinition, rootDefinition } from './fixtures.test-helper';
import {
  validateAgentDefinitionActivation,
  type AgentDefinitionActivationRegistries,
} from './invariants';

const validRegistries: AgentDefinitionActivationRegistries = {
  runtimeClasses: new Map([['general-agent', new Set(['streaming', 'structured-output'])]]),
  tools: new Set(['read']),
  resources: new Set(['entity']),
  contextSources: new Set(['entity']),
  verifiers: new Set(['schema']),
  evalEvidence: new Map([
    ['eval:base@1', { passed: true, score: 0.9, artifactHash: `sha256:${'a'.repeat(64)}` }],
  ]),
};

function definitions(root = rootDefinition()): AgentDefinitionSourceRegistry {
  return new Map<AgentDefinitionRef, { status: 'active'; source: typeof root }>([
    [root.ref, { status: 'active', source: root }],
  ]);
}

describe('Agent Definition activation invariants', () => {
  it('reports all seven passing checks for a valid flattened definition', () => {
    const report = validateAgentDefinitionActivation(
      'base-agent@1',
      definitions(),
      validRegistries,
    );
    expect(report.pass).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual([
      'prompt-bindings-valid',
      'runtime-features-valid',
      'tools-registered',
      'resource-policy-valid',
      'verifiers-registered',
      'eval-evidence-valid',
      'derivation-acyclic',
    ]);
    expect(report.checks.every((check) => check.pass)).toBe(true);
  });

  it('reports every independent activation failure without short-circuiting', () => {
    const invalid = rootDefinition({
      prompt: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'bad',
            role: 'system',
            purpose: 'task-data',
            binding: {
              source: 'task',
              pointer: '/missing',
              encoding: 'json-delimited',
              required: true,
            },
          },
        ],
      },
      runtimeRequirements: { class: 'missing-runtime', features: ['shell'] },
      policies: {
        tools: { allowed: ['shell'] },
        context: { allowedSources: ['database'], maxItems: 1 },
        resources: { allowed: ['workspace'] },
        artifacts: { allowedMediaTypes: [], maxCount: 0, maxBytes: 0 },
      },
      evaluationPolicy: {
        verifiers: ['citations'],
        evalSuiteRefs: ['eval:missing'],
        minimumScore: 1,
      },
    });
    const report = validateAgentDefinitionActivation(
      invalid.ref,
      definitions(invalid),
      validRegistries,
    );
    expect(report.pass).toBe(false);
    expect(report.checks.map((check) => [check.name, check.pass])).toEqual([
      ['prompt-bindings-valid', false],
      ['runtime-features-valid', false],
      ['tools-registered', false],
      ['resource-policy-valid', false],
      ['verifiers-registered', false],
      ['eval-evidence-valid', false],
      ['derivation-acyclic', true],
    ]);
    expect(report.checks.flatMap((check) => check.detail ?? [])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('task pointer /missing'),
        expect.stringContaining('missing-runtime'),
        expect.stringContaining('tool shell'),
        expect.stringContaining('resource workspace'),
        expect.stringContaining('context source database'),
        expect.stringContaining('verifier citations'),
        expect.stringContaining('eval evidence eval:missing'),
      ]),
    );
  });

  it('fails closed with a full report when an exact parent is missing or cyclic', () => {
    const child = childDefinition();
    const missing = validateAgentDefinitionActivation(
      child.ref,
      new Map([[child.ref, { status: 'active' as const, source: child }]]),
      validRegistries,
    );
    expect(missing.checks).toHaveLength(7);
    expect(missing.checks.every((check) => !check.pass)).toBe(true);
    expect(missing.checks.at(-1)?.detail?.[0]).toMatch(/parent base-agent@1 is missing/);

    const a = {
      ...child,
      ref: 'a-agent@1' as const,
      name: 'a-agent',
      extends: 'b-agent@1' as const,
    };
    const b = {
      ...child,
      ref: 'b-agent@1' as const,
      name: 'b-agent',
      extends: 'a-agent@1' as const,
    };
    const cyclic = validateAgentDefinitionActivation(
      a.ref,
      new Map([
        [a.ref, { status: 'active' as const, source: a }],
        [b.ref, { status: 'active' as const, source: b }],
      ]),
      validRegistries,
    );
    expect(cyclic.checks.at(-1)).toMatchObject({ name: 'derivation-acyclic', pass: false });
    expect(cyclic.checks.at(-1)?.detail?.[0]).toMatch(/cycle/);
  });

  it('resolves local schema refs for declared Prompt binding pointers and rejects remote refs', () => {
    const local = rootDefinition({
      contracts: {
        ...rootDefinition().contracts,
        inputSchema: {
          $defs: { task: { type: 'object', properties: { objective: { type: 'string' } } } },
          $ref: '#/$defs/task',
        },
      },
    });
    expect(
      validateAgentDefinitionActivation(local.ref, definitions(local), validRegistries).checks[0],
    ).toMatchObject({ pass: true });
    const remote = rootDefinition({
      contracts: {
        ...rootDefinition().contracts,
        inputSchema: { $ref: 'https://example.com/task.json' },
      },
    });
    expect(
      validateAgentDefinitionActivation(remote.ref, definitions(remote), validRegistries).checks[0],
    ).toMatchObject({ pass: false });
  });
});
