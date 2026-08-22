// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EntityLinkWord } from './entity-link';

afterEach(cleanup);

describe('EntityLinkWord', () => {
  it('links a bound identity to the same semantic Canvas runtime', () => {
    render(<EntityLinkWord label="第一篇" rel="post:first-post" />);
    const link = screen.getByRole('link', { name: /第一篇/ });
    expect(link.getAttribute('href')).toBe('/canvas?focus=post%3Afirst-post');
    expect(link.getAttribute('data-nav')).toBe('presentation:member');
  });
});
