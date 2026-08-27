// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fold, project, type SirenEntity } from '@ui4a/engine';
import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';

import { businessFlows } from '../domain/flows';
import { SEED_REL, seedDetail } from '../domain/seed';
import { EntityView } from './entity-view';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function snapshotAt(node: string): EngineSnapshot {
  const snapshot = fold([{ seq: 1, kind: 'seed', rel: SEED_REL, detail: seedDetail }], {
    flows: businessFlows,
  });
  return {
    ...snapshot,
    instances: {
      ...snapshot.instances,
      'writing-request:main': { ...snapshot.instances['writing-request:main']!, node },
    },
  };
}

function entityAt(node: string): SirenEntity {
  return project(snapshotAt(node), 'writing-request:main', {
    flows: businessFlows,
    guards: seedGuardRegistry,
  })!;
}

describe('Writing request human Renderer contract', () => {
  it('renders the brief from the declared action schema without Provider or runtime controls', () => {
    vi.stubGlobal('fetch', vi.fn());
    const entity = entityAt('brief-draft');
    render(<EntityView rel="writing-request:main" entity={entity} />);
    // D50:开始写作表单默认收起,先打开再断言 brief 字段
    fireEvent.click(screen.getByRole('button', { name: '开始写作 ⌄' }));

    expect(screen.getByLabelText(/写作目标/)).toBeTruthy();
    expect(screen.getByLabelText(/目标读者/)).toBeTruthy();
    expect(screen.getByText('必需章节')).toBeTruthy();
    expect(screen.getByText('授权来源')).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始写作 ⌄' })).toBeTruthy();
    expect(screen.queryByText(/provider|endpoint|api key|model/i)).toBeNull();
    expect(entity.actions.map(({ name }) => name)).toEqual(['start-writing']);
  });

  it('never renders internal callbacks and exposes only declared human review actions', () => {
    vi.stubGlobal('fetch', vi.fn());
    const running = entityAt('writing-running');
    expect(running.actions).toEqual([]);

    const review = entityAt('review-ready');
    render(<EntityView rel="writing-request:main" entity={review} />);
    const declared = review.actions.map(({ name }) => name);
    expect(declared).toEqual(['accept-writing-result', 'reject-writing-result']);
    expect(screen.getByRole('button', { name: '接受写作结果' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '驳回写作结果 ⌄' }));
    expect(screen.getByLabelText(/驳回原因/)).toBeTruthy();
    expect(screen.queryByText(/发布/)).toBeNull();
  });

  it('renders Run progress, contracted document/citations and render evidence from Siren data', () => {
    vi.stubGlobal('fetch', vi.fn());
    const run: SirenEntity = {
      class: ['agent-run', 'succeeded', 'event-native'],
      properties: {
        rel: 'agent-run:writing-1',
        status: 'succeeded',
        questions: [],
        result: {
          resultId: 'writing-result-1',
          payload: {
            writingResult: {
              summary: 'Launch note draft is ready.',
              citations: [{ sourceId: 'release', paragraphs: [2] }],
            },
          },
          evidence: [{ kind: 'markdown-render', ref: 'render:writing-result-1' }],
        },
      },
      actions: [],
      links: [
        { rel: ['source'], href: '/api/entity?rel=writing-request%3Amain' },
        { rel: ['artifact'], href: '/api/entity?rel=artifact%3Awriting-result-1' },
      ],
      'guard-results': [],
    };

    const { container } = render(<EntityView rel="agent-run:writing-1" entity={run} />);
    expect(screen.getByText(/Launch note draft is ready/)).toBeTruthy();
    expect(screen.getByText(/markdown-render/)).toBeTruthy();
    expect(screen.getByText('artifact:writing-result-1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看原始合同' })).toBeTruthy();
    expect(container.querySelector('[data-action]')).toBeNull();
  });
});
