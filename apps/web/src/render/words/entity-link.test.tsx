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

  it('declares a Work Thread when the generic member target is thread:<id>', () => {
    render(<EntityLinkWord label="发布工作线" rel="thread:release-1" />);
    expect(screen.getByRole('link', { name: /发布工作线/ }).getAttribute('href')).toBe(
      '/canvas?focus=thread%3Arelease-1&thread=release-1',
    );
  });
});
