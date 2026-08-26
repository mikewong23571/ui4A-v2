import { describe, expect, it } from 'vitest';

import { situationForChat } from './chat-situation';

describe('chat situation adapter', () => {
  it('keeps headless chat on the workstation deployment default without a client view', async () => {
    await expect(situationForChat({ principal: 'user:headless' })).resolves.toMatchObject({
      site: 'workstation',
      scope: 'default',
      focus: null,
    });
  });
});
