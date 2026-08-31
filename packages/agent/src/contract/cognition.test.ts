import type { SirenEntity } from '@ui4a/engine';
import { expect, it } from 'vitest';

import { sanitizeEntity, sanitizeProperties } from './cognition';

it('includes declared top-level status/content while leaving undeclared raw data out', () => {
  const properties = {
    rel: 'thread:release',
    identity: '交付公告',
    statusText: '进行中',
    resume: '等待批准',
    raw: { secret: 'UNDECLARED_DATA' },
    presentation: {
      fields: [
        { path: 'properties.statusText', title: '状态', role: 'status' },
        { path: 'properties.resume', title: '进度', role: 'primary-content' },
      ],
    },
  };
  const result = sanitizeProperties(properties, false);
  expect(result).toMatchObject({ identity: '交付公告', statusText: '进行中', resume: '等待批准' });
  expect(JSON.stringify(result)).not.toContain('UNDECLARED_DATA');
  expect(sanitizeProperties(properties, true)).not.toHaveProperty('resume');
});

it('preserves only current action schemas and limits collection members', () => {
  const entity: SirenEntity = {
    class: ['collection'],
    properties: { rel: 'items', count: 20 },
    links: [],
    actions: [],
    entities: Array.from({ length: 20 }, (_, index) => ({
      class: ['resource'],
      properties: { rel: `item:${index}`, identity: `资源 ${index}` },
      links: [],
      actions: [],
    })),
  };
  const result = sanitizeEntity(entity);
  expect(result.entities).toHaveLength(8);
  expect(JSON.stringify(result)).not.toContain('item:8');
  expect(entity.entities).toHaveLength(20);
});
