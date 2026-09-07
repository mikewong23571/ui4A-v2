import { expect, it } from 'vitest';
import type { SirenEntity } from '../contract/siren/types';
import { projectThreadActionExperience } from './work-thread-action-experience';
const thread: SirenEntity = {
  class: ['work-thread'],
  properties: { rel: 'thread:review' },
  actions: ['detach', 'archive'].map((name) => ({
    name,
    title: name,
    method: 'POST',
    href: '/api/exec',
    fields: {},
  })),
  links: [{ rel: ['event'], href: '/api/events?afterSeq=40' }],
  entities: [
    {
      class: ['thread-reference'],
      properties: { rel: 'message:one', identity: '原文摘要', category: 'context' },
      actions: [],
      links: [],
    },
  ],
};
it('declares only authorized projected references with exact unlink parameters, recursively', () => {
  const result = projectThreadActionExperience({
    class: ['collection'],
    properties: {},
    actions: [],
    links: [],
    entities: [thread],
  }).entities![0]!;
  expect(result.actions[0]!.fields['x-ui4a-reference-selection']).toEqual({
    effect: 'unlink',
    options: [
      { title: '原文摘要', params: { category: 'context', rel: 'message:one' } },
      { title: '事件 41', params: { category: 'event', rel: 'event:41' } },
    ],
  });
  expect(result.actions[1]!.fields.description).toContain('不再提供恢复');
  expect(thread.actions[0]!.fields).toEqual({});
});
it('empty authorized references expose an empty selection and unrelated actions stay untouched', () => {
  const result = projectThreadActionExperience({ ...thread, entities: [], links: [] });
  expect(result.actions[0]!.fields['x-ui4a-reference-selection']).toEqual({
    effect: 'unlink',
    options: [],
  });
  const unrelated = { ...thread, class: ['future-domain'] };
  expect(projectThreadActionExperience(unrelated).actions).toBe(unrelated.actions);
});
