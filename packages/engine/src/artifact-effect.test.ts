import { describe, expect, it } from 'vitest';

import type { EngineSnapshot, FlowDefinition } from '@ui4a/shared';
import { artifactInputValid, seedGuardRegistry } from '@ui4a/shared';

import { applyEffects } from './effects';
import { executeWithGates } from './execute';
import { approveConfirmation } from './confirmation';
import { parseFlowDefinition } from './parse';

const flow: FlowDefinition = parseFlowDefinition({
  name: 'post-status',
  initial: 'published',
  nodes: [
    {
      name: 'published',
      actions: [
        {
          name: 'save-summary',
          title: '保存正式摘要',
          guards: ['artifact-input-valid'],
          'requires-confirmation': 'high',
          fields: [
            {
              name: 'summaryArtifact',
              type: 'text',
              required: true,
              semantics: 'work-product',
              source: { kind: 'effect', capability: 'summarize', from: 'body' },
            },
          ],
          effect: {
            type: 'set-field',
            field: 'summaryArtifact',
            'from-param': 'summaryArtifact',
            origin: 'effect',
          },
        },
      ],
    },
  ],
});

const snapshot: EngineSnapshot = {
  instances: {
    'post:first-post': {
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: {},
    },
  },
  collections: {},
  artifacts: {
    'artifact:summary-a1': {
      rel: 'artifact:summary-a1',
      id: 'summary-a1',
      capability: 'summarize',
      source: { rel: 'post:first-post', field: 'body' },
      model: 'stub',
      outputSchema: { type: 'object' },
      content: { summary: 'summary' },
      contentHash: 'sha256:a1',
      createdBy: { actor: 'agent' },
    },
  },
};

describe('artifact-backed field effect', () => {
  it('通用 guard 从 action field source 校验 capability 与 source rel', () => {
    expect(
      artifactInputValid({
        instance: snapshot.instances['post:first-post']!,
        snapshot,
        params: { summaryArtifact: 'artifact:summary-a1' },
        action: flow.nodes[0]!.actions[0],
      }),
    ).toBe(true);
    expect(
      artifactInputValid({
        instance: snapshot.instances['post:first-post']!,
        snapshot,
        params: {},
        action: flow.nodes[0]!.actions[0],
      }),
    ).toBe(true);
    expect(
      artifactInputValid({
        instance: snapshot.instances['post:first-post']!,
        snapshot,
        params: { summaryArtifact: 'artifact:missing' },
        action: flow.nodes[0]!.actions[0],
      }),
    ).toBe(false);
  });

  it('声明 action 只把 artifact 引用写入业务字段，不复制模型内容', () => {
    const outcome = applyEffects(
      {
        rel: 'post:first-post',
        action: 'save-summary',
        params: { summaryArtifact: 'artifact:summary-a1' },
        actor: 'human',
      },
      flow.nodes[0]!.actions[0]!.effect as never[],
      snapshot,
      { flows: { 'post-status': flow } },
    );

    expect(outcome.snapshot.instances['post:first-post']?.fields.summaryArtifact).toEqual({
      value: 'artifact:summary-a1',
      origin: 'effect',
    });
    expect(outcome.snapshot.instances['post:first-post']?.fields.summary).toBeUndefined();
  });

  it('无有效 artifact 时在 guard 层拒绝且零写', () => {
    const result = executeWithGates(
      {
        rel: 'post:first-post',
        action: 'save-summary',
        params: { summaryArtifact: 'artifact:missing' },
        actor: 'agent',
      },
      snapshot,
      { flows: { 'post-status': flow }, guards: seedGuardRegistry },
    );

    expect(result).toMatchObject({ kind: 'rejected', layer: 'guard-failed' });
    expect(snapshot.instances['post:first-post']?.fields).toEqual({});
  });

  it('有效 artifact 的保存 action 先挂起，human approve 后才写 artifact 引用', () => {
    const suspended = executeWithGates(
      {
        rel: 'post:first-post',
        action: 'save-summary',
        params: { summaryArtifact: 'artifact:summary-a1' },
        actor: 'agent',
        principal: 'user:mike',
      },
      snapshot,
      { flows: { 'post-status': flow }, guards: seedGuardRegistry },
    );
    expect(suspended.kind).toBe('suspended');
    if (suspended.kind !== 'suspended') throw new Error('expected suspended');
    expect(suspended.snapshot.instances['post:first-post']?.fields.summaryArtifact).toBeUndefined();

    const approved = approveConfirmation(
      suspended.snapshot,
      suspended.confirmation.id,
      { actor: 'human', principal: 'user:mike' },
      { flows: { 'post-status': flow }, guards: seedGuardRegistry },
    );
    expect(approved.kind).toBe('confirmed');
    if (approved.kind !== 'confirmed') throw new Error('expected confirmed');
    expect(approved.snapshot.instances['post:first-post']?.fields.summaryArtifact).toEqual({
      value: 'artifact:summary-a1',
      origin: 'effect',
    });
    expect(approved.snapshot.artifacts?.['artifact:summary-a1']?.content).toEqual({
      summary: 'summary',
    });
  });
});
