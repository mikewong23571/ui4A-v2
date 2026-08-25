/**
 * step 帧活动语言固定词表测试(T24 Phase B Task 2):协议 op → 「正在做什么」
 * 的舞台机械词汇(纯常量映射,零每实体/每应用分支)。
 *
 * - 词表覆盖 agent 协议全部实际 op(navigate/answer/clarify/present/exec/
 *   exec-plan/done/fail);未知 op 中性回退「正在处理 · {op}」,不静默吞;
 * - {title}/{subject} 由服务器从合同取,客户端零猜测;缺失占位渲染为空,
 *   不伪造标题;
 * - 活动语言不得出现机制词(呈现诚实化)。
 */
import { describe, expect, it } from 'vitest';

import { MECHANISM_WORDS } from '@/lib/mechanism-words';

import {
  STEP_ACTIVITY_WORDS,
  UNKNOWN_STEP_ACTIVITY_WORD,
  stepActivityText,
} from './step-activity-words';

describe('STEP_ACTIVITY_WORDS(固定 op 词表)', () => {
  it('覆盖 agent 协议全部实际 op,无遗留', () => {
    expect(Object.keys(STEP_ACTIVITY_WORDS).sort()).toEqual(
      ['answer', 'clarify', 'done', 'exec', 'exec-plan', 'fail', 'navigate', 'present'].sort(),
    );
  });

  it('模板为零分支字面量:标题/主题仅经占位符进入', () => {
    expect(STEP_ACTIVITY_WORDS.navigate).toBe('正在读取 {title}');
    expect(STEP_ACTIVITY_WORDS.exec).toBe('正在执行 {title}');
    expect(STEP_ACTIVITY_WORDS.present).toBe('正在准备「{subject}」的呈现');
    expect(STEP_ACTIVITY_WORDS.answer).toBe('正在整理回答');
    expect(STEP_ACTIVITY_WORDS.fail).toBe('遇到问题');
  });

  it('词表与回退模板零机制词', () => {
    for (const text of [...Object.values(STEP_ACTIVITY_WORDS), UNKNOWN_STEP_ACTIVITY_WORD]) {
      expect(MECHANISM_WORDS.some((word) => text.includes(word))).toBe(false);
    }
  });
});

describe('stepActivityText(结构化数据 → 活动语言)', () => {
  it('navigate/exec 消费服务器合同标题;present 消费 subject', () => {
    expect(stepActivityText({ op: 'navigate', title: '文章列表' })).toBe('正在读取 文章列表');
    expect(stepActivityText({ op: 'exec', title: '完成编辑' })).toBe('正在执行 完成编辑');
    expect(stepActivityText({ op: 'present', subject: '文章列表' })).toBe(
      '正在准备「文章列表」的呈现',
    );
    expect(stepActivityText({ op: 'answer' })).toBe('正在整理回答');
    expect(stepActivityText({ op: 'fail' })).toBe('遇到问题');
  });

  it('未知 op 中性回退并显式携带 op,不静默吞', () => {
    expect(stepActivityText({ op: 'frobnicate' })).toBe('正在处理 · frobnicate');
  });

  it('标题缺失时占位渲染为空(不伪造标题)', () => {
    expect(stepActivityText({ op: 'navigate' })).toBe('正在读取');
    expect(stepActivityText({ op: 'present' })).toBe('正在准备「」的呈现');
  });
});
