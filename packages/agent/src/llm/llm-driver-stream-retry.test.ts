import { describe, expect, it } from 'vitest';

import { createLlmDriver } from './llm-driver';
import { createScriptedTransport, instanceEntity } from '../testkit/testkit';
import type { DriverContext } from '../types';

const config = {
  apiKey: 'test-key',
  baseURL: 'https://provider.test/v1',
  model: 'test-model',
} as const;

function context(): DriverContext {
  return {
    goal: { verb: '查看文章' },
    currentRel: 'articles',
    entity: instanceEntity({ rel: 'articles', flow: 'articles', node: 'collection' }),
    trail: [],
    successes: [],
  };
}

function answerResponse(): Response {
  const chunks = [
    {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1755700000,
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'answer',
                  arguments: JSON.stringify({
                    content: '断流重试后完成',
                    sources: [{ rel: 'articles', pointer: '/properties/fields' }],
                  }),
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-test',
      object: 'chat.completion.chunk',
      created: 1755700000,
      model: 'test-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    },
  ];
  const body = `${chunks.map((entry) => `data: ${JSON.stringify(entry)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('LLM driver SSE terminated recovery', () => {
  it('retries only the current decision and returns the successful tool operation', async () => {
    let attempts = 0;
    const transport = createScriptedTransport(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('terminated');
      return answerResponse();
    });
    const driver = createLlmDriver({ ...config, fetchImpl: transport.fetch });

    await expect(driver.decide(context())).resolves.toMatchObject({
      kind: 'answer',
      content: '断流重试后完成',
    });
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]?.body).toEqual(transport.calls[0]?.body);
  });

  it('fails honestly after three consecutive terminated streams', async () => {
    const transport = createScriptedTransport(() => {
      throw new Error('terminated');
    });
    const driver = createLlmDriver({ ...config, fetchImpl: transport.fetch });

    await expect(driver.decide(context())).resolves.toEqual({
      kind: 'fail',
      reason: 'LLM 调用失败: terminated',
    });
    expect(transport.calls).toHaveLength(3);
  });
});
