import { describe, expect, it } from 'vitest';

import { parseExecBody, parsePlanBody } from './exec-request';

const authorization = { sourceMessageId: 'turn-1', quote: '把第一篇文章归档' };

describe('exec audit evidence HTTP contract', () => {
  it('拒绝请求侧覆盖 SubmissionPolicy', () => {
    for (const override of [
      { mode: 'direct' },
      { submissionMode: 'direct' },
      { noDraft: true },
    ]) {
      expect(parseExecBody({ rel: 'post:first', action: 'unpublish', ...override })).toEqual({
        ok: false,
        error: 'SubmissionPolicy 由服务端合同决定，请求不得覆盖',
      });
    }
  });

  it('单动作保留结构化授权索引，非法形状 fail closed', () => {
    expect(
      parseExecBody({
        rel: 'post:first-post',
        action: 'archive',
        actor: 'agent',
        channel: 'chat',
        authorization,
      }),
    ).toMatchObject({ ok: true, request: { authorization } });
    expect(
      parseExecBody({
        rel: 'post:first-post',
        action: 'archive',
        authorization: { sourceMessageId: 'turn-1' },
      }),
    ).toEqual({ ok: false, error: expect.stringContaining('authorization') });
  });

  it('计划级证据复制到每个标准 ExecRequest，保证每步事件可独立审计', () => {
    expect(
      parsePlanBody({
        actor: 'agent',
        channel: 'chat',
        authorization,
        steps: [
          { rel: 'post:first-post', action: 'unpublish' },
          { rel: 'post:second-post', action: 'archive' },
        ],
      }),
    ).toMatchObject({
      ok: true,
      steps: [{ authorization }, { authorization }],
    });
  });
});
