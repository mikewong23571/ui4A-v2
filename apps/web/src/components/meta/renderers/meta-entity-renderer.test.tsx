// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { MetaEntityRenderer } from './meta-entity-renderer';

afterEach(cleanup);

function siren(classes: string[], properties: Record<string, unknown>): SirenEntity {
  return { class: classes, properties, actions: [], links: [], 'guard-results': [] };
}

describe('Meta entity renderer', () => {
  it('uses the Application specialization and keeps raw bundle secondary', () => {
    render(
      <MetaEntityRenderer
        scope="publishing"
        entity={siren(['meta', 'application-definition'], {
          name: 'publishing',
          title: '内容发布',
          intent: '起草并发布文章。',
          bundle: {
            bundle: { version: 1 },
            flows: [{ name: 'post-status', title: '文章状态' }],
            capabilities: [],
            policies: [],
          },
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: '内容发布' })).toBeTruthy();
    expect(screen.getByText('起草并发布文章。')).toBeTruthy();
    expect(screen.getByText(/只读/)).toBeTruthy();
    expect(screen.getByText('原始合同')).toBeTruthy();
  });

  it('uses generic fallback for an unknown legal collection without a white screen', () => {
    render(
      <MetaEntityRenderer
        scope="publishing"
        entity={{
          ...siren(['collection', 'meta/widgets'], { rel: 'meta/widgets', count: 1 }),
          entities: [siren(['meta', 'widget'], { name: 'one', title: 'Widget One' })],
        }}
      />,
    );
    expect(screen.getByText(/通用合同视图/)).toBeTruthy();
    expect(screen.getByText('Widget One')).toBeTruthy();
  });

  it('renders Agent authority/binding/runtime boundaries and redacts raw secrets', () => {
    render(
      <MetaEntityRenderer
        scope="governance"
        entity={siren(['meta', 'agent-definition', 'active'], {
          ref: 'author@1',
          name: 'author',
          status: 'active',
          intent: 'Draft definitions without approving them.',
          runtimeClass: 'authoring',
          requiredFeatures: ['structured-result'],
          prompt: {
            blocks: [
              {
                id: 'a',
                purpose: 'authority',
                role: 'system',
                sealed: true,
                literal: 'No approve.',
              },
              {
                id: 't',
                purpose: 'task-data',
                role: 'user',
                binding: { source: 'task', pointer: '/brief' },
              },
            ],
          },
          apiKey: 'must-not-render',
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: /author@1/ })).toBeTruthy();
    expect(screen.getByText('封闭权威')).toBeTruthy();
    expect(screen.getByText('数据绑定')).toBeTruthy();
    expect(screen.getByText('部署要求')).toBeTruthy();
    expect(screen.queryByText('must-not-render')).toBeNull();
  });
});
