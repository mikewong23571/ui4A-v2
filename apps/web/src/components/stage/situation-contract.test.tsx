// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applicationOptions,
  contextEntityEndpoint,
  contextEntityTitle,
  contextReferenceHref,
  situationDocumentLabel,
  situationFocusLabel,
  threadContextRels,
  threadOptions,
  useSituationDocument,
  useThreadContextReferences,
  workspaceFocusLabel,
} from './situation-contract';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entity = (title: string) => ({ properties: { identity: title } });
const thread = (...rels: string[]) => ({
  links: rels.map((rel) => ({
    rel: ['context'],
    href: `/api/entity?rel=${encodeURIComponent(rel)}`,
  })),
});

describe('situation contract labels and references', () => {
  it('supplements only readable exact entities from the fresh authorized discovery', () => {
    const discovery = {
      status: 'ready' as const,
      value: { surfaces: [{ rel: 'meta/future', title: '将来的定义' }] },
    };
    expect(
      situationFocusLabel(
        { status: 'ready', value: { properties: { rel: 'meta/future' } } },
        'meta/future',
        discovery,
      ),
    ).toBe('将来的定义');
    expect(
      situationFocusLabel({ status: 'ready', value: entity('对象名称') }, 'meta/future', discovery),
    ).toBe('对象名称');
    expect(situationFocusLabel({ status: 'error', value: null }, 'meta/future', discovery)).toBe(
      '无法读取',
    );
    expect(situationFocusLabel({ status: 'loading', value: null }, 'meta/future', discovery)).toBe(
      '读取中…',
    );
    expect(
      situationFocusLabel({ status: 'ready', value: {} }, 'meta/future', {
        status: 'loading',
        value: null,
      }),
    ).toBe('读取中…');
    expect(
      situationFocusLabel({ status: 'ready', value: {} }, 'meta/future', {
        status: 'error',
        value: null,
      }),
    ).toBe('无法读取');
    expect(situationFocusLabel({ status: 'ready', value: {} }, 'meta/absent', discovery)).toBe(
      '无法读取',
    );
  });

  it('uses declared titles and no hard-coded applications or raw-id fallback', () => {
    expect(
      applicationOptions({
        applications: [
          { name: 'new-team', title: '新团队' },
          { name: 'new-team', title: '新团队' },
          { name: 'unnamed' },
          null,
        ],
      }),
    ).toEqual([{ name: 'new-team', title: '新团队' }]);
    for (const invalid of [null, [], {}, { applications: 'bad' }]) {
      expect(applicationOptions(invalid)).toEqual([]);
    }
    expect(contextEntityTitle({ properties: { identity: '目标', title: '节点' } })).toBe('目标');
    expect(contextEntityTitle({ properties: { title: '集合' } })).toBe('集合');
    expect(contextEntityTitle({ properties: { rel: 'post:unresolved' } })).toBeNull();
    expect(
      contextEntityTitle({ properties: { rel: 'post:one', identity: 'post:one', title: '文章' } }),
    ).toBe('文章');
  });

  it('follows at most four unique explicit context/active/approval links', () => {
    const document = thread('post:1', 'post:1', 'post:2', 'post:3', 'post:4', 'post:5');
    document.links.unshift(
      { rel: ['self'], href: '/api/entity?rel=thread:one' },
      { rel: ['event'], href: '/api/entity?rel=event:1' },
      { rel: ['context', 'dangling'], href: '/api/entity?rel=missing:one' },
      { rel: ['context'], href: 'https://other.example/api/entity?rel=secret:1' },
      { rel: ['context'], href: '/not-entity?rel=secret:2' },
      { rel: ['context'], href: 'http://[' },
      { rel: ['context'], href: '/api/entity' },
    );
    expect(threadContextRels(document)).toEqual(['post:1', 'post:2', 'post:3', 'post:4']);
    expect(threadContextRels({ links: [null] })).toEqual([]);
    expect(threadContextRels(null)).toEqual([]);
  });

  it('maps only canonical endpoints and preserves explicit context in navigation', () => {
    expect(contextEntityEndpoint('meta/applications')).toBe(
      '/_meta/api/entity?rel=meta%2Fapplications',
    );
    expect(contextEntityEndpoint('draft:one')).toBe('/_meta/api/entity?rel=draft%3Aone');
    expect(contextEntityEndpoint('post:one')).toBe('/api/entity?rel=post%3Aone');
    expect(contextEntityEndpoint('workspace:app:publishing')).toBeNull();
    expect(contextReferenceHref('/canvas?scope=a&thread=t&focus=old', 'post:one')).toBe(
      '/entity?rel=post%3Aone&scope=a&thread=t',
    );
    expect(contextReferenceHref('/canvas?scope=a&thread=t', 'thread:new')).toBe(
      '/entity?rel=thread%3Anew&thread=new&scope=a',
    );
    expect(
      contextReferenceHref('/entity?rel=thread:a&thread=a&returnTo=%2Fthreads', 'thread:b'),
    ).toBe('/entity?rel=thread%3Ab&thread=b&returnTo=%2Fthreads');
    expect(contextReferenceHref('/entity?returnTo=https%3A%2F%2Fother.example', 'thread:b')).toBe(
      '/entity?rel=thread%3Ab&thread=b',
    );
  });

  it('names virtual views without attempting to read them as business entities', () => {
    expect(
      workspaceFocusLabel('workspace:app:new-team', [{ name: 'new-team', title: '新团队' }]),
    ).toBe('新团队');
    expect(workspaceFocusLabel('workspace:app:not-granted', [])).toBe('无法读取');
    expect(workspaceFocusLabel('workspace:my-work', [])).toBe('工作区');
    expect(workspaceFocusLabel('post:one', [])).toBeNull();
  });

  it('keeps missing/failed/loading labels concise and never substitutes an identifier', () => {
    expect(situationDocumentLabel({ status: 'loading', value: null })).toBe('读取中…');
    expect(situationDocumentLabel({ status: 'error', value: null })).toBe('无法读取');
    expect(situationDocumentLabel({ status: 'ready', value: {} })).toBe('无法读取');
    expect(situationDocumentLabel({ status: 'ready', value: entity('发布公告') })).toBe('发布公告');
    expect(
      threadOptions({
        entities: [
          { properties: { rel: 'thread:a', identity: '发布公告' } },
          { properties: { rel: 'thread:b' } },
          { properties: { rel: 'post:b', title: '其他' } },
        ],
      }),
    ).toEqual([{ rel: 'thread:a', title: '发布公告' }]);
    expect(threadOptions(null)).toEqual([]);
  });
});

describe('situation reads', () => {
  it('re-reads on reopening; failed reads cannot restore old labels', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(entity('原来的标题')))
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook(
      ({ key }) => useSituationDocument('/api/entity?rel=post%3A1', key),
      { initialProps: { key: 'closed' } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ key: 'open' });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.value).toBeNull();
    expect(fetcher).toHaveBeenLastCalledWith('/api/entity?rel=post%3A1', { cache: 'no-store' });
  });

  it('does not read missing selections and ignores responses from the previous location', async () => {
    let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              finish = resolve;
            }),
        )
        .mockResolvedValueOnce(Response.json(entity('新对象'))),
    );
    const { result, rerender } = renderHook(
      ({ endpoint }) => useSituationDocument(endpoint, 'route'),
      { initialProps: { endpoint: null as string | null } },
    );
    expect(fetch).not.toHaveBeenCalled();
    rerender({ endpoint: '/api/entity?rel=old' });
    rerender({ endpoint: '/api/entity?rel=new' });
    await waitFor(() => expect(contextEntityTitle(result.current.value)).toBe('新对象'));
    await act(async () => {
      finish(Response.json(entity('旧对象')));
    });
    expect(contextEntityTitle(result.current.value)).toBe('新对象');
  });

  it('resolves authorized labels and drops denied or unlabeled references without stale fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(entity('相关资料')))
        .mockResolvedValueOnce(new Response('', { status: 403 }))
        .mockResolvedValueOnce(Response.json({ properties: { rel: 'post:3' } }))
        .mockResolvedValueOnce(Response.json(entity('post:4'))),
    );
    const source = thread('post:1', 'post:2', 'post:3', 'post:4', 'post:5');
    const { result, rerender } = renderHook(
      ({ enabled, document }) => useThreadContextReferences(document, enabled),
      { initialProps: { enabled: false, document: source } },
    );
    expect(fetch).not.toHaveBeenCalled();
    rerender({ enabled: true, document: source });
    await waitFor(() =>
      expect(result.current.value).toEqual([{ rel: 'post:1', title: '相关资料' }]),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 403 }));
    rerender({ enabled: true, document: thread('post:1', 'post:2', 'post:3', 'post:4') });
    expect(result.current.value).toBeNull();
    await waitFor(() => expect(result.current.value).toEqual([]));
  });
});
