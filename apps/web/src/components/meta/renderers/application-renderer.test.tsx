// @vitest-environment jsdom
/**
 * T52 Phase 4:meta/application:<name> 实体页 deprecate 动作渲染钉测。
 *
 * 零新增硬编码控件(I3):停用按钮只来自 Siren actions 镜像(引擎
 * APPLICATION_LIFECYCLE 声明,P3 已投影 requires-confirmation 'high' +
 * 可选 reason 字段 + guard-results)。本文件钉死既有 canonical 渲染链
 * (registry → application renderer → MetaActions → ActionRunner 两步确认 →
 * /_meta/api/exec)对该实体的连通性,以及 default 地板 guard-results 的
 * disabled + 人话提示呈现(D71.6)。fixture 形状镜像引擎投影
 * (application-lifecycle.test.ts 与 toSirenAction/fieldDefinitionsToJsonSchema
 * 的 wire 口径:textarea → string+format,reason 不进 required)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GuardResultEntry, SirenAction, SirenEntity } from '@ui4a/engine';

import { MetaEntityRenderer } from './meta-entity-renderer';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** deprecate 声明的 wire 形状(引擎 toSirenAction 派生)。 */
function deprecateAction(): SirenAction {
  return {
    name: 'deprecate',
    title: '停用',
    method: 'POST',
    href: '/_meta/api/exec',
    fields: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { reason: { type: 'string', format: 'textarea' } },
      required: [],
      additionalProperties: false,
    },
    'requires-confirmation': 'high',
  };
}

/** 非默认应用:guard-results 投影 fail-closed 只有 actor-is-human。 */
function nonDefaultGuard(): GuardResultEntry {
  return {
    action: 'deprecate',
    blocked: true,
    reason: '此操作需要人本人执行(审批不委托)(guard 不满足: actor-is-human=false)',
    guards: [
      { name: 'actor-is-human', pass: false },
      { name: 'application-not-default', pass: true },
    ],
  };
}

/** default 地板(D71.6):application-not-default 亦失败(guardBlockReason 人话口径)。 */
function defaultFloorGuard(): GuardResultEntry {
  return {
    action: 'deprecate',
    blocked: true,
    reason:
      '此操作需要人本人执行(审批不委托);默认应用不可停用(系统地板)' +
      '(guard 不满足: actor-is-human=false, application-not-default=false)',
    guards: [
      { name: 'actor-is-human', pass: false },
      { name: 'application-not-default', pass: false },
    ],
  };
}

function applicationEntity(input: {
  name: 'publishing' | 'default';
  'guard-results'?: GuardResultEntry[];
  actions?: SirenAction[];
}): SirenEntity {
  const rel = `meta/application:${input.name}`;
  return {
    class: ['meta', 'application-definition'],
    properties: {
      rel,
      name: input.name,
      title: input.name === 'default' ? '默认应用' : '内容发布',
      intent: input.name === 'default' ? '无归属 flow 的兜底归组' : '内容起草与发布',
      status: 'active',
      version: 1,
      bundle: {
        bundle: { name: input.name, version: 1 },
        flows: [{ name: 'post-status', title: '文章状态' }],
        capabilities: [],
        policies: [],
      },
    },
    actions: input.actions ?? [deprecateAction()],
    links: [{ rel: ['self'], href: `/_meta/api/entity?rel=${encodeURIComponent(rel)}` }],
    'guard-results': input['guard-results'] ?? [],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('meta/application:<name> deprecate(T52 P4 canonical 渲染链)', () => {
  it('renders the declared deprecate action through the canonical action surface', () => {
    render(
      <MetaEntityRenderer
        rel="meta/application:publishing"
        navigation={{ scope: 'publishing' }}
        entity={applicationEntity({ name: 'publishing', 'guard-results': [nonDefaultGuard()] })}
      />,
    );

    expect(screen.getByRole('heading', { name: '可用动作' })).toBeTruthy();
    const deprecate = screen.getByRole('button', { name: '停用' }) as HTMLButtonElement;
    // 投影 fail-closed 只有 actor-is-human:human renderer 解除 disabled(blockedForRenderer)。
    expect(deprecate.disabled).toBe(false);
    // 声明了 reason 字段 → 参数表单路径(而非无字段推送按钮)。
    expect(deprecate.getAttribute('data-presentation-action')).toBe('open-form');
  });

  it('renders no deprecate control when the contract declares none (I3 action-backed)', () => {
    render(
      <MetaEntityRenderer
        rel="meta/application:publishing"
        navigation={{ scope: 'publishing' }}
        entity={applicationEntity({ name: 'publishing', actions: [] })}
      />,
    );

    expect(screen.queryByRole('button', { name: '停用' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '可用动作' })).toBeNull();
    expect(screen.getByText(/只读/)).toBeTruthy();
  });

  it('disables deprecate on the default application floor and shows the human guard hint', () => {
    render(
      <MetaEntityRenderer
        rel="meta/application:default"
        navigation={{}}
        entity={applicationEntity({ name: 'default', 'guard-results': [defaultFloorGuard()] })}
      />,
    );

    const deprecate = screen.getByRole('button', { name: '停用' }) as HTMLButtonElement;
    expect(deprecate.disabled).toBe(true);
    // 谓词的按钮投影:disabled + guard-results 的人话原因(GUARD_HINTS 主句)。
    expect(deprecate.getAttribute('title')).toContain('默认应用不可停用(系统地板)');
    expect(screen.getByText(/默认应用不可停用\(系统地板\)/)).toBeTruthy();
  });

  it('confirms the high-risk deprecate in two steps and submits via /_meta/api/exec', async () => {
    const current = applicationEntity({
      name: 'publishing',
      'guard-results': [nonDefaultGuard()],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(current))
      .mockResolvedValueOnce(jsonResponse({ entity: current }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(
      <MetaEntityRenderer
        rel="meta/application:publishing"
        navigation={{ scope: 'publishing' }}
        entity={current}
        onChanged={onChanged}
      />,
    );

    // 第一步:打开参数表单(声明了可选 reason),提交只是显式"请求"。
    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    const reason = (await screen.findByLabelText(/^reason/i)) as HTMLTextAreaElement;
    expect(reason.tagName).toBe('TEXTAREA');
    fireEvent.change(reason, { target: { value: '迁移到 publishing-v2' } });
    fireEvent.click(document.querySelector('button[type="submit"][data-action="deprecate"]')!);
    expect(screen.getByText(/尚未执行/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    // 第二步:确认才 fresh-read 当前声明并 POST /_meta/api/exec。
    fireEvent.click(screen.getByRole('button', { name: '确认并执行停用' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/_meta/api/entity?rel=meta%2Fapplication%3Apublishing&scope=publishing',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/_meta/api/exec?scope=publishing');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      rel: 'meta/application:publishing',
      action: 'deprecate',
      params: { reason: '迁移到 publishing-v2' },
    });
    expect(onChanged).toHaveBeenCalledWith('meta/application:publishing');
  });

  it('cancels the confirmation request without any exec call', () => {
    render(
      <MetaEntityRenderer
        rel="meta/application:publishing"
        navigation={{ scope: 'publishing' }}
        entity={applicationEntity({ name: 'publishing', 'guard-results': [nonDefaultGuard()] })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    fireEvent.click(document.querySelector('button[type="submit"][data-action="deprecate"]')!);
    expect(screen.getByText(/尚未执行/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消请求' }));
    expect(screen.queryByText(/尚未执行/)).toBeNull();
    // 取消是零业务事件的 presentation interaction:两步确认缺一不可。
    expect(screen.getByRole('button', { name: '停用' })).toBeTruthy();
  });
});
