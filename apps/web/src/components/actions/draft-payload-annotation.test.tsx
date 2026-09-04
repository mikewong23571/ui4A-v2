// @vitest-environment jsdom
/**
 * T50 Phase 3 / D69.1 RJSF 承重墙:create/revise 表单的 payload 控件形态。
 *
 * 动作合同自注解 x-ui4a-payload-schemas 后,人类表单必须零退化:payload 属性
 * 保持精确 {} 宽松形状(它是 action-json-fields JSON textarea 投影的依据),
 * 注解挂 fields 顶层 x- 描述符。字段级挂法(type 同级)已被证伪——投影启发
 * 不再命中,RJSF 对无 type 属性走 FallbackField,payload 控件整个消失。
 * 本测试用服务端真实合同(draft-action-schemas)驱动渲染,固定承重行为。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { draftCreateAction, draftReviseAction } from '@/engine/drafts/draft-action-schemas';

import { MetaEntityRenderer } from '../meta/renderers/meta-entity-renderer';

function draftCollection(): SirenEntity {
  return {
    class: ['collection', 'meta/drafts'],
    properties: { rel: 'meta/drafts', count: 0, limit: 20 },
    actions: [draftCreateAction()],
    links: [{ rel: ['self'], href: '/_meta/api/entity?rel=meta%2Fdrafts' }],
    entities: [],
    'guard-results': [],
  };
}

function exactDraft(): SirenEntity {
  return {
    class: ['meta', 'draft', 'application-bundle', 'invalid'],
    properties: {
      rel: 'draft:d9',
      id: 'd9',
      owner: 'local-user',
      policyScope: 'development',
      kind: 'application-bundle',
      target: 'demo-bundle',
      status: 'invalid',
      version: 1,
      maxVersion: 1,
      validation: { valid: false, issues: [{ code: 'parse-error', path: '/' }] },
      payload: { bundle: { name: 'demo-bundle', version: 1 } },
      provenance: { actor: 'human', principal: 'local-user', sources: [] },
    },
    actions: [draftReviseAction()],
    links: [{ rel: ['self'], href: '/_meta/api/entity?rel=draft%3Ad9' }],
    'guard-results': [],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Draft payload schema annotation vs the human form (D69.1 承重墙)', () => {
  it('keeps the create form payload a labeled JSON textarea under the annotated contract', () => {
    render(
      <MetaEntityRenderer
        rel="meta/drafts"
        navigation={{ scope: 'development' }}
        entity={draftCollection()}
      />,
    );

    // 被渲染的确实是带注解合同(承重对象存在,不是宽松回退)。
    const fields = draftCreateAction().fields;
    expect(JSON.stringify(fields)).toContain('"x-ui4a-payload-schemas"');
    expect(JSON.stringify((fields.properties as Record<string, unknown>).payload)).toBe('{}');

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));
    const kind = screen.getByLabelText(/^kind/i) as HTMLSelectElement;
    expect([...kind.options].map((option) => option.textContent)).toContain('application-bundle');
    const payload = screen.getByLabelText(/payload/i) as HTMLTextAreaElement;
    expect(payload.tagName).toBe('TEXTAREA');
    expect(document.querySelector('button[type="submit"][data-action="create"]')).toBeTruthy();
  });

  it('keeps the revise form payload an editable JSON textarea and submits the parsed value', async () => {
    const current = exactDraft();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(current), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ entity: current }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MetaEntityRenderer rel="draft:d9" navigation={{ scope: 'development' }} entity={current} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revise Draft' }));
    const payload = (await screen.findByLabelText(/payload/i)) as HTMLTextAreaElement;
    expect(payload.tagName).toBe('TEXTAREA');
    expect(JSON.parse(payload.value)).toEqual({ bundle: { name: 'demo-bundle', version: 1 } });
    fireEvent.change(payload, {
      target: { value: '{"bundle":{"name":"ideas","version":1}}' },
    });
    fireEvent.click(document.querySelector('button[type="submit"][data-action="revise"]')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, request] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as {
      rel: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(body).toMatchObject({
      rel: 'draft:d9',
      action: 'revise',
      params: { baseVersion: 1, payload: { bundle: { name: 'ideas', version: 1 } } },
    });
  });
});
