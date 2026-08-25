import { describe, expect, it } from 'vitest';

import type { EngineSnapshot } from '@ui4a/shared';

import {
  artifactRel,
  applyCapabilityArtifactCreated,
  type CapabilityArtifactCreatedDetail,
} from './capability-artifact';
import { fold } from './fold/index';
import { project } from '../contract/siren/index';

const detail: CapabilityArtifactCreatedDetail = {
  id: 'summary-a1',
  capability: 'summarize',
  source: { rel: 'post:first-post', field: 'body' },
  model: 'stub-summary-model',
  outputSchema: {
    type: 'object',
    required: ['summary'],
    properties: { summary: { type: 'string' } },
  },
  content: { summary: '验证文章查看、正文阅读和刷新恢复。' },
  contentHash: 'sha256:abc123',
  createdBy: { actor: 'agent', principal: 'user:mike' },
};

const base: EngineSnapshot = {
  instances: {
    'post:first-post': {
      rel: 'post:first-post',
      flow: 'post-status',
      node: 'published',
      fields: { body: { value: 'source', origin: 'default' } },
    },
  },
  collections: {},
  capabilities: {
    summarize: {
      name: 'summarize',
      title: '正式摘要',
      kind: 'transform',
      intent: '把文章正文转换为正式摘要工件。',
    },
  },
};

describe('capability artifact', () => {
  it('物化带 source/model/capability/schema/content hash 的正式工件并可重放', () => {
    const event = {
      seq: 1,
      kind: 'capability-artifact-created' as const,
      rel: artifactRel(detail.id),
      actor: 'agent' as const,
      detail,
    };

    const online = applyCapabilityArtifactCreated(base, event);
    const replayed = fold([event], { flows: {} }, base);

    expect(replayed.artifacts).toEqual(online.artifacts);
    expect(replayed.artifacts?.[artifactRel(detail.id)]).toEqual({
      rel: 'artifact:summary-a1',
      ...detail,
    });
  });

  it('以独立 Siren 实体披露 provenance，模型内容不混入业务 fields', () => {
    const snapshot = applyCapabilityArtifactCreated(base, {
      seq: 1,
      kind: 'capability-artifact-created',
      rel: artifactRel(detail.id),
      actor: 'agent',
      detail,
    });

    expect(project(snapshot, 'artifact:summary-a1', { flows: {}, guards: {} })).toMatchObject({
      class: ['capability-artifact', 'summarize'],
      properties: {
        rel: 'artifact:summary-a1',
        capability: 'summarize',
        source: { rel: 'post:first-post', field: 'body' },
        model: 'stub-summary-model',
        'content-hash': 'sha256:abc123',
      },
    });
    expect(snapshot.instances['post:first-post']?.fields.summary).toBeUndefined();
  });

  it('未注册 capability 不能物化正式工件，输入快照保持不变', () => {
    const withoutCapability = { ...base, capabilities: {} };
    expect(() =>
      applyCapabilityArtifactCreated(withoutCapability, {
        seq: 1,
        rel: artifactRel(detail.id),
        detail,
      }),
    ).toThrow('未注册能力');
    expect(withoutCapability.artifacts).toBeUndefined();
    expect(withoutCapability.instances['post:first-post']?.fields.summary).toBeUndefined();
  });
});
