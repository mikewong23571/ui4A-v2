import { describe, expect, it } from 'vitest';

import {
  ideasApplicationBundle,
  todoApplicationBundle,
  walkthroughApplicationBundle,
} from './bundles';

describe('walkthrough application entries', () => {
  it('parses structured default entries for every installed application scope', () => {
    expect(
      Object.fromEntries(
        walkthroughApplicationBundle.applications.map(({ name, entry }) => [name, entry]),
      ),
    ).toEqual({
      default: undefined,
      publishing: { target: 'flow:article-drafting', role: 'primary-create' },
      community: { target: 'comments', role: 'primary-collection' },
      development: { target: 'flow:software-change', role: 'primary-task' },
      editorial: { target: 'flow:writing-request', role: 'primary-task' },
      governance: { target: 'flow:agent-definition-authoring', role: 'primary-task' },
    });
  });

  it('keeps direct bundle versions aligned with changed installed declaration data', () => {
    expect(todoApplicationBundle.bundle).toEqual({ name: 'todo', version: 7 });
    expect(ideasApplicationBundle.bundle).toEqual({ name: 'ideas', version: 7 });

    expect(todoApplicationBundle.flows.find(({ name }) => name === 'todo-item')).toMatchObject({
      collections: [{ collection: 'todos', filters: [{ field: 'status' }] }],
      cognitive: { version: 1, traits: ['work-queue'], emptyMeaning: 'ready-to-start' },
      fields: [
        { name: 'title', presentation: { role: 'identity', overview: true } },
        { name: 'note', presentation: { role: 'primary-content', overview: true } },
      ],
    });
    expect(ideasApplicationBundle.flows.find(({ name }) => name === 'idea-item')).toMatchObject({
      collections: [{ collection: 'ideas', filters: [{ field: 'status' }] }],
      cognitive: { version: 1, traits: ['work-queue'], emptyMeaning: 'ready-to-start' },
      fields: [
        { name: 'title', presentation: { role: 'identity', overview: true } },
        { name: 'insight', presentation: { role: 'primary-content', overview: true } },
      ],
    });
  });
});
