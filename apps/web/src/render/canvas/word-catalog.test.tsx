// @vitest-environment jsdom
/**
 * 画布 A2UI 词汇目录测试(T7 Phase B / spec 架构决定 1/3):官方 SDK 全链
 * ——MessageProcessor(目录协商)→ 四消息 → A2uiSurface 渲染出词条组件。
 *
 * - 目录 = basic 布局原语 + 我们的十数据词条(自定义扩展目录);
 * - 词条 props 经数据模型路径绑定(generic binder 解析 {path});
 * - action 事件经拦截门:未声明动作拒绝且零 /api/exec(basic Button 走查)。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';
import { A2uiSurface } from '@a2ui/react/v0_9';
import { MessageProcessor } from '@a2ui/web_core/v0_9';

import { createActionGate } from './action-gate';
import { articlesCollection } from '../words/fixtures';

import { ui4aRenderCatalog } from './word-catalog';

afterEach(cleanup);

const ARTICLES = articlesCollection();
const CATALOG_ID = 'https://ui4a.dev/render/v1/catalog.json';

/** 消息序列的宽类型(SDK 合同形状;构造侧直出)。 */
type Messages = Parameters<MessageProcessor<never>['processMessages']>[0];

function entityDeclaring(rel: string, actions: string[]): SirenEntity {
  return {
    class: ['flow-instance'],
    properties: { rel },
    actions: actions.map((name) => ({
      name,
      title: name,
      method: 'POST',
      href: '/api/exec',
      fields: { type: 'object', properties: {} },
    })),
    links: [],
  };
}

describe('A2UI 词汇目录(官方 SDK 全链)', () => {
  it('目录身份:catalogId 与 /api/render/catalog 同源,components 含 basic 原语 + 十词条', () => {
    expect(ui4aRenderCatalog.id).toBe(CATALOG_ID);
    const names = [...ui4aRenderCatalog.components.keys()];
    for (const word of [
      'table',
      'chart',
      'stat',
      'timeline',
      'flow',
      'form',
      'diff',
      'kanban',
      'markdown',
      'detail',
    ]) {
      expect(names, word).toContain(word);
    }
    // 基础目录布局原语仍在(数据词条我们补,原语不重造)
    for (const primitive of ['Button', 'Text', 'Card', 'Row', 'Column']) {
      expect(names, primitive).toContain(primitive);
    }
  });

  it('createSurface + updateDataModel + updateComponents → A2uiSurface 渲染 table 词条', async () => {
    const processor = new MessageProcessor([ui4aRenderCatalog], () => Promise.resolve());
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'articles-table', catalogId: CATALOG_ID } },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'articles-table',
          path: '/concerns/articles-table/props',
          value: { rows: ARTICLES.entities },
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'articles-table',
          components: [
            {
              component: 'table',
              id: 'root',
              rows: { path: '/concerns/articles-table/props/rows' },
            },
          ],
        },
      },
    ] as Messages);

    const surface = processor.model.getSurface('articles-table');
    expect(surface).toBeDefined();
    render(<A2uiSurface surface={surface!} />);

    // 词条组件经数据模型路径绑定拿到 deref 值:表格内容 = articles 成员
    await waitFor(() => {
      expect(screen.getByText('欢迎来到 UI4A')).toBeTruthy();
    });
    expect(screen.getByText('第一篇')).toBeTruthy();
    expect(screen.getByText('tech')).toBeTruthy();
    expect(screen.getByText('essay')).toBeTruthy();
  });

  it('basic Button 事件 → 已声明动作经拦截门转发 /api/exec', async () => {
    const execFn = vi.fn().mockResolvedValue({ ok: true, entity: ARTICLES });
    const gate = createActionGate(execFn as never);
    gate.register(entityDeclaring('post:post-welcome', ['unpublish']));

    const processor = new MessageProcessor([ui4aRenderCatalog], async (action) => {
      await gate.handle(action as never);
    });
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'btn-ok', catalogId: CATALOG_ID } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'btn-ok',
          components: [
            {
              component: 'Button',
              id: 'root',
              child: 'btn-ok-text',
              action: { event: { name: 'unpublish', context: { rel: 'post:post-welcome' } } },
            },
            { component: 'Text', id: 'btn-ok-text', text: '下线它' },
          ],
        },
      },
    ] as Messages);

    render(<A2uiSurface surface={processor.model.getSurface('btn-ok')!} />);
    fireEvent.click(screen.getByRole('button', { name: '下线它' }));
    await waitFor(() => expect(execFn).toHaveBeenCalledTimes(1));
    const [input] = execFn.mock.calls[0] as unknown as [{ rel: string; action: string }];
    expect(input).toEqual({ rel: 'post:post-welcome', action: 'unpublish' });
  });

  it('未声明动作的 Button 事件:拦截门拒绝,零 /api/exec(白名单外拒)', async () => {
    const execFn = vi.fn();
    const gate = createActionGate(execFn as never);
    gate.register(entityDeclaring('post:post-welcome', []));

    const processor = new MessageProcessor([ui4aRenderCatalog], async (action) => {
      await gate.handle(action as never);
    });
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 'btn-bad', catalogId: CATALOG_ID } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'btn-bad',
          components: [
            {
              component: 'Button',
              id: 'root',
              child: 'btn-nuke-text',
              action: { event: { name: 'nuke', context: { rel: 'post:post-welcome' } } },
            },
            { component: 'Text', id: 'btn-nuke-text', text: '全删' },
          ],
        },
      },
    ] as Messages);

    render(<A2uiSurface surface={processor.model.getSurface('btn-bad')!} />);
    fireEvent.click(screen.getByRole('button', { name: '全删' }));
    // 拦截门异步裁决:零 /api/exec 调用发生
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(execFn).not.toHaveBeenCalled();
  });
});
