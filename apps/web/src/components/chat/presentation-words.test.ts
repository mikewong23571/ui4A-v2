/**
 * presentation 回执固定措辞与消息列表应用测试:reasonCode 查表/通用回退、
 * pending 占位追加与同号去重、failed 替换占位/无占位追加、ready 移除占位,
 * 以及主行文案零机制词纪律(机制词 reasonCode 原文只作末尾次要附属)。
 */
import { describe, expect, it } from 'vitest';

import type { PresentationReceipt } from '@ui4a/shared';

import { MECHANISM_WORDS } from '@/lib/mechanism-words';

import { applyPresentationReceipt, type ChatUiMessage } from './chat-types';
import {
  PRESENTATION_FAILURE_GENERIC,
  PRESENTATION_FAILURE_WORDS,
  PRESENTATION_PENDING_WORD,
  presentationFailureText,
} from './presentation-words';

function receipt(
  status: PresentationReceipt['status'],
  extra: Partial<PresentationReceipt> = {},
): PresentationReceipt {
  return { schemaVersion: 1, requestId: 'req-1', status, ...extra } as PresentationReceipt;
}

describe('presentationFailureText(reasonCode → 失败条目全文)', () => {
  it('已知 reasonCode 查表:主行「呈现失败」+ 中性短语,原文末尾次要', () => {
    expect(presentationFailureText('authorization-failed')).toBe(
      '呈现失败 · 未获授权 · reasonCode=authorization-failed',
    );
    expect(presentationFailureText('planning-failed')).toBe(
      '呈现失败 · 无法准备呈现 · reasonCode=planning-failed',
    );
  });

  it('D51 taxonomy 两新 code 查表:授予外与不存在分流措辞,原文末尾次要(B1)', () => {
    expect(presentationFailureText('audience-unreachable')).toBe(
      '呈现失败 · 所属应用未启用 · reasonCode=audience-unreachable',
    );
    expect(presentationFailureText('subject-unavailable')).toBe(
      '呈现失败 · 没有这个内容 · reasonCode=subject-unavailable',
    );
    // 词表条目与 shared taxonomy 常量同源,零字面量漂移。
    expect(Object.keys(PRESENTATION_FAILURE_WORDS)).toContain('audience-unreachable');
    expect(Object.keys(PRESENTATION_FAILURE_WORDS)).toContain('subject-unavailable');
  });

  it('未知 reasonCode:通用主行,原文只作次要附属(不编造原因)', () => {
    expect(presentationFailureText('planner-unavailable')).toBe(
      '呈现失败 · reasonCode=planner-unavailable',
    );
  });

  it('缺失 reasonCode:仅通用主行', () => {
    expect(presentationFailureText(undefined)).toBe(PRESENTATION_FAILURE_GENERIC);
    expect(PRESENTATION_FAILURE_GENERIC).toBe('呈现失败');
  });

  it('主行措辞与 pending 占位零机制词', () => {
    const lines = [
      PRESENTATION_PENDING_WORD,
      ...Object.values(PRESENTATION_FAILURE_WORDS),
      PRESENTATION_FAILURE_GENERIC,
    ];
    for (const line of lines) {
      expect(MECHANISM_WORDS.some((word) => line.includes(word))).toBe(false);
    }
  });
});

describe('applyPresentationReceipt(回执 → 消息列表)', () => {
  it('pending 追加「正在准备呈现」占位(带 requestId 标识)', () => {
    const next = applyPresentationReceipt([], receipt('pending'));
    expect(next).toEqual([
      {
        role: 'assistant',
        content: PRESENTATION_PENDING_WORD,
        presentation: { requestId: 'req-1', status: 'pending' },
      },
    ]);
  });

  it('同 requestId 的 pending 重复帧不重复追加', () => {
    const once = applyPresentationReceipt([], receipt('pending'));
    expect(applyPresentationReceipt(once, receipt('pending'))).toBe(once);
  });

  it('failed 无占位时追加失败条目', () => {
    const next = applyPresentationReceipt(
      [],
      receipt('failed', { reasonCode: 'authorization-failed' }),
    );
    expect(next).toEqual([
      {
        role: 'assistant',
        content: '呈现失败 · 未获授权 · reasonCode=authorization-failed',
        presentation: { requestId: 'req-1', status: 'failed', reasonCode: 'authorization-failed' },
      },
    ]);
  });

  it('pending → failed:原位替换为失败条目,占位不悬挂', () => {
    const next = applyPresentationReceipt(
      applyPresentationReceipt([], receipt('pending')),
      receipt('failed', { reasonCode: 'planning-failed' }),
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      content: '呈现失败 · 无法准备呈现 · reasonCode=planning-failed',
      presentation: { requestId: 'req-1', status: 'failed' },
    });
  });

  it('pending → ready:移除占位', () => {
    const next = applyPresentationReceipt(
      applyPresentationReceipt([], receipt('pending')),
      receipt('ready', { surfaceUrl: '/canvas?scope=publishing' }),
    );
    expect(next).toEqual([]);
  });

  it('ready/fallback 无同号占位:原列表不变', () => {
    const base: ChatUiMessage[] = [{ role: 'assistant', content: '回答' }];
    expect(applyPresentationReceipt(base, receipt('ready', { surfaceUrl: '/canvas' }))).toBe(base);
  });
});
