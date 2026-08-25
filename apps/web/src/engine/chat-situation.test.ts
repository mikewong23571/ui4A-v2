import { describe, expect, it } from 'vitest';

import { situationForChat } from './chat-situation';

describe('chat situation adapter', () => {
  it('keeps headless chat on the business deployment default without a client view', async () => {
    await expect(situationForChat({ principal: 'user:headless' })).resolves.toMatchObject({
      site: 'business',
      scope: 'default',
      focus: null,
    });
  });
});
