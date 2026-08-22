/**
 * 轨迹 → 聊天消息投影测试(T2 Phase E / Task E2,arch-brief §8:
 * 聊天界面就是事件日志的投影层)。
 * 每步一条 assistant 消息:导航到 X / 执行 Y / 被拒:原因 / 完成。
 */
import { describe, expect, it } from 'vitest';

import { trailToMessages } from './trail';
import type { AgentRunResult, TrailStep } from '@ui4a/agent';

function step(partial: Partial<TrailStep> & Pick<TrailStep, 'rel' | 'op' | 'outcome'>): TrailStep {
  return { step: 1, ...partial };
}

describe('trailToMessages', () => {
  it('每步一条消息:导航/执行/被拒/完成', () => {
    const steps: TrailStep[] = [
      step({
        rel: 'flow:article-drafting',
        op: { kind: 'navigate', rel: 'flow:article-drafting' },
        outcome: 'navigated',
      }),
      step({
        rel: 'article-drafting:main',
        op: { kind: 'exec', action: 'next', params: { title: 'T' } },
        outcome: 'executed',
      }),
      step({
        rel: 'post:post-welcome',
        op: { kind: 'exec', action: 'unpublish' },
        outcome: 'rejected',
        rejection: {
          rel: 'post:post-welcome',
          action: 'unpublish',
          reason: 'guard 不满足: is-published=false',
        },
      }),
      step({
        rel: 'article-drafting:main',
        op: { kind: 'done', summary: '文章已发布' },
        outcome: 'done',
      }),
    ];
    const messages = trailToMessages({
      goal: { verb: '发布' },
      outcome: 'done',
      summary: '文章已发布',
      steps,
      successes: [],
    } as AgentRunResult);

    expect(messages.map((message) => message.role)).toEqual([
      'assistant',
      'assistant',
      'assistant',
      'assistant',
    ]);
    expect(messages[0]!.text).toBe('导航到 flow:article-drafting');
    expect(messages[1]!.text).toContain('执行 next(article-drafting:main)');
    expect(messages[1]!.text).toContain('title');
    expect(messages[2]!.text).toContain('被拒 unpublish(post:post-welcome)');
    expect(messages[2]!.text).toContain('guard 不满足');
    expect(messages[3]!.text).toBe('完成: 文章已发布');
  });

  it('导航不可达 → 导航失败消息带原因;fail 步 → 失败消息带原因(B4 错误原文进对话)', () => {
    const steps: TrailStep[] = [
      step({
        rel: 'articles',
        op: { kind: 'navigate', rel: 'nope' },
        outcome: 'not-found',
        rejection: { rel: 'nope', layer: 'not-found', reason: '实体 "nope" 不存在' },
      }),
      step({
        rel: 'articles',
        op: { kind: 'fail', reason: 'LLM 调用失败: HTTP 401 令牌无效' },
        outcome: 'failed',
      }),
    ];
    const messages = trailToMessages({
      goal: { verb: 'x' },
      outcome: 'failed',
      summary: 'LLM 调用失败: HTTP 401 令牌无效',
      steps,
      successes: [],
    } as AgentRunResult);

    expect(messages[0]!.text).toContain('导航失败(nope)');
    expect(messages[0]!.text).toContain('实体 "nope" 不存在');
    expect(messages[1]!.text).toBe('失败: LLM 调用失败: HTTP 401 令牌无效');
  });

  it('answer 直接投影自然语言内容，不加完成前缀', () => {
    const answer = step({
      rel: 'post:first-post',
      op: {
        kind: 'answer',
        content: '第一篇文章用于验证正文阅读与刷新恢复。',
        sources: [{ rel: 'post:first-post', pointer: '/properties/fields/body' }],
      },
      outcome: 'answered',
    });

    expect(
      trailToMessages({
        goal: { verb: '总结第一篇文章' },
        outcome: 'answered',
        summary: '第一篇文章用于验证正文阅读与刷新恢复。',
        sources: answer.op.kind === 'answer' ? answer.op.sources : [],
        steps: [answer],
        successes: [],
      })[0]!.text,
    ).toBe('第一篇文章用于验证正文阅读与刷新恢复。');
  });

  it('present 只投影旁路准备状态，不冒充业务完成', () => {
    const message = trailToMessages({
      goal: { verb: '看看第一篇' },
      outcome: 'answered',
      steps: [
        step({
          rel: 'post:first-post',
          op: {
            kind: 'present',
            subject: 'post:first-post',
            intent: 'read article',
            delivery: 'canvas',
          },
          outcome: 'presentation-requested',
        }),
      ],
      successes: [],
    }).at(0);

    expect(message?.text).toBe('正在准备「post:first-post」的呈现');
  });

  it('max-steps 结局补一条上限消息(无终步消息时)', () => {
    const steps: TrailStep[] = [
      step({ rel: 'articles', op: { kind: 'navigate', rel: 'articles' }, outcome: 'navigated' }),
    ];
    const messages = trailToMessages({
      goal: { verb: 'x' },
      outcome: 'max-steps',
      summary: '达到步数上限 24 未收到 done/fail',
      steps,
      successes: [],
    } as AgentRunResult);
    expect(messages[messages.length - 1]!.text).toContain('步数上限');
  });
});
