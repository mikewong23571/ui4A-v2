import { describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { applicationViewModel } from './application';

const application: SirenEntity = {
  class: ['meta', 'application-definition'],
  properties: {
    name: 'publishing',
    title: '内容发布',
    intent: '起草、发布并管理文章。',
    status: 'active',
    bundle: {
      schema: 'https://ui4a.dev/application-definition-bundle/v1',
      bundle: { name: 'publishing', version: 3 },
      applications: [],
      flows: [
        { name: 'article-drafting', title: '文章起草', nodes: [] },
        { name: 'post-status', title: '文章状态', nodes: [] },
      ],
      capabilities: [{ name: 'draft', title: '工件起草', kind: 'extract' }],
      policies: [{ subject: 'application:publishing', submission: { mode: 'draft' } }],
      provenance: {
        source: 'active-definition-log',
        application: 'publishing',
        flows: [
          { name: 'article-drafting', version: 2 },
          { name: 'post-status', version: 1 },
        ],
      },
    },
  },
  actions: [],
  links: [],
  'guard-results': [],
};

describe('Application Meta view model', () => {
  it('mechanically extracts task-first overview, relationships and provenance', () => {
    expect(applicationViewModel(application)).toMatchObject({
      name: 'publishing',
      title: '内容发布',
      intent: '起草、发布并管理文章。',
      status: 'active',
      version: 3,
      flows: [
        { name: 'article-drafting', title: '文章起草', version: 2 },
        { name: 'post-status', title: '文章状态', version: 1 },
      ],
      capabilities: [{ name: 'draft', title: '工件起草', kind: 'extract' }],
      policies: [{ subject: 'application:publishing', mode: 'draft' }],
      readOnly: true,
    });
  });

  it('does not invent actions or relationships for an empty bundle', () => {
    const empty = { ...application, properties: { name: 'empty', title: 'Empty', intent: 'None' } };
    expect(applicationViewModel(empty)).toMatchObject({
      flows: [],
      capabilities: [],
      policies: [],
      readOnly: true,
    });
  });
});
