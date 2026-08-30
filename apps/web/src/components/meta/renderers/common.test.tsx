// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SirenEntity } from '@ui4a/engine';

import { RawContract } from './common';

const entity: SirenEntity = {
  class: ['meta', 'future-definition'],
  properties: { rel: 'meta/future:f1', nested: { value: 'only-when-open' } },
  actions: [],
  links: [],
};

afterEach(cleanup);

describe('RawContract disclosure', () => {
  it('supports click, Enter, Space and Escape while serializing only when open', () => {
    render(<RawContract entity={entity} />);

    const summary = screen.getByText('原始合同');
    const details = summary.parentElement as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(screen.queryByText(/only-when-open/)).toBeNull();

    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText(/only-when-open/)).toBeTruthy();

    fireEvent.keyDown(details, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(screen.queryByText(/only-when-open/)).toBeNull();

    fireEvent.keyDown(summary, { key: 'Enter' });
    expect(details.open).toBe(true);
    fireEvent.keyDown(details, { key: 'Escape' });

    fireEvent.keyDown(summary, { key: ' ' });
    expect(details.open).toBe(true);
    fireEvent.keyDown(details, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });
});
