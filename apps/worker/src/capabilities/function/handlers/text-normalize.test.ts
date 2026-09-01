import { describe, expect, it } from 'vitest';

import { normalizeReferenceText } from './text-normalize';

describe('reference text normalize Native Function', () => {
  it('executes the second registered transform without Application-specific dispatch code', async () => {
    await expect(
      normalizeReferenceText(
        { text: '  one   two ' },
        { executionId: 'nf-1-aaaaaaaaaaaa', signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ output: { text: 'one two' } });
  });
});
