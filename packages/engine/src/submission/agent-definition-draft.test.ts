import { describe, expect, it } from 'vitest';

import type { AgentDefinitionRef } from '@ui4a/shared';

import { childDefinition, rootDefinition } from '../agent-definition/fixtures.test-helper';
import type {
  AgentDefinitionActivationRegistries,
  AgentDefinitionSourceRegistry,
} from '../agent-definition/index';
import {
  mechanicalAgentDefinitionDiff,
  validateAgentDefinitionDraft,
} from './agent-definition-draft';

const activationRegistries: AgentDefinitionActivationRegistries = {
  runtimeClasses: new Map([['general-agent', new Set(['streaming', 'structured-output'])]]),
  tools: new Set(['read']),
  resources: new Set(['entity']),
  contextSources: new Set(['entity']),
  verifiers: new Set(['schema']),
  evalEvidence: new Map([
    ['eval:base@1', { passed: true, score: 0.9, artifactHash: `sha256:${'a'.repeat(64)}` }],
  ]),
};

function definitions(): AgentDefinitionSourceRegistry {
  const root = rootDefinition();
  return new Map<AgentDefinitionRef, { status: 'active'; source: typeof root }>([
    [root.ref, { status: 'active', source: root }],
  ]);
}

describe('Agent Definition Draft validation', () => {
  it('parses, derives and runs every activation check without changing the active registry', () => {
    const active = definitions();
    const candidate = childDefinition();
    const validation = validateAgentDefinitionDraft(candidate, {
      definitions: active,
      activationRegistries,
    });

    expect(validation).toMatchObject({ valid: true, value: candidate });
    expect(validation.artifact).toMatchObject({
      ref: 'writing-agent@1',
      definition: { ref: 'writing-agent@1', intent: 'Write an evidence-backed document' },
    });
    expect(validation.checks?.every((check) => check.pass)).toBe(true);
    expect(active.has('writing-agent@1')).toBe(false);
  });

  it('returns parse and activation issues as Draft validation data', () => {
    expect(
      validateAgentDefinitionDraft(
        { name: 'broken' },
        {
          definitions: definitions(),
          activationRegistries,
        },
      ),
    ).toMatchObject({
      valid: false,
      issues: [{ code: 'parse-error', path: '/' }],
    });

    const invalid = childDefinition({ extends: 'missing-agent@1' });
    const validation = validateAgentDefinitionDraft(invalid, {
      definitions: definitions(),
      activationRegistries,
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'derivation-acyclic',
          message: expect.stringContaining('missing'),
        }),
      ]),
    );
  });

  it('shows separate authored and flattened effective mechanical diffs', () => {
    const parent = rootDefinition();
    const candidate = childDefinition();
    const validation = validateAgentDefinitionDraft(candidate, {
      definitions: definitions(),
      activationRegistries,
    });
    expect(validation.artifact).toBeDefined();

    const mechanical = mechanicalAgentDefinitionDiff({
      beforeSource: parent,
      afterSource: candidate,
      beforeEffective: parent,
      afterEffective: validation.artifact!.definition,
    });

    expect(mechanical.authored.before).toEqual(parent);
    expect(mechanical.authored.after).toEqual(candidate);
    expect(mechanical.effective.after).toMatchObject({
      ref: 'writing-agent@1',
      prompt: { blocks: expect.arrayContaining([expect.objectContaining({ id: 'authority' })]) },
    });
    expect(mechanical.hash).toMatch(/^fnv1a64:/);
  });
});
