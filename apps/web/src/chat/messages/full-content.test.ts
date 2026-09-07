import { expect, it, vi } from 'vitest';
import { planGenericSurface } from '@ui4a/engine';
import { getMessageEntity } from '../message-entity';
import { PRESENTATION_SURFACE_CATALOG } from '../../engine/presentation/catalog';
import { semanticHintsOf } from '../../engine/presentation/situation';

const content = '这是原始消息的第一段。'.repeat(12) + '\n\n第二段 <b>保留原始字符</b>\n第三行';
vi.mock('@ui4a/db/events', () => ({
  listEvents: async () => [{ detail: { messageId: 'long', role: 'user', content } }],
}));

it.each(['read', 'review'] as const)(
  'binds the full multiline original message in a %s surface',
  async (intent) => {
    const entity = await getMessageEntity({} as never, 'message:long', 'me');
    expect(entity?.properties.content).toBe(content);
    expect(String(entity?.properties.identity).length).toBeLessThanOrEqual(80);
    const surface = planGenericSurface('message:long', entity!, PRESENTATION_SURFACE_CATALOG, {
      intent,
      entityVersion: 'test',
      semanticHints: semanticHintsOf(entity!),
    });
    expect(JSON.stringify(surface)).toContain('"path":"properties.content"');
    expect(semanticHintsOf(entity!)).toMatchObject({
      'properties.identity': 'identity',
      'properties.content': 'primary-content',
    });
    expect(entity?.properties.presentation).toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ path: 'properties.content', contentMediaType: 'text/plain' }),
      ]),
    });
    expect(JSON.stringify(surface)).not.toContain(content);
  },
);
