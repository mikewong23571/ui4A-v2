// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SirenEntity } from '@ui4a/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RawContractContent, RawContractDrawer } from './raw-contract-drawer';

const entity: SirenEntity = {
  class: ['flow-instance'],
  properties: { rel: 'post:first', fields: { title: 'First' } },
  actions: [],
  links: [],
};

afterEach(() => cleanup());

describe('raw contract lens', () => {
  it('serializes the exact authorized Siren entity without fetching or assembling', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<RawContractContent entity={entity} />);

    expect(screen.getByTestId('raw-contract-json').textContent).toBe(
      JSON.stringify(entity, null, 2),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('is a local two-step drawer with an I3 annotation, not a navigation destination', () => {
    render(<RawContractDrawer entity={entity} />);

    const trigger = screen.getByRole('button', { name: '查看原始合同' });
    expect(trigger.getAttribute('data-nav')).toBe('local:raw-contract');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('complementary', { name: '原始合同' })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('complementary', { name: '原始合同' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '关闭原始合同' }));
    expect(screen.queryByRole('complementary', { name: '原始合同' })).toBeNull();
  });

  it('does not invent a contract for a virtual or unavailable subject', () => {
    render(<RawContractDrawer entity={undefined} />);

    expect(screen.getByRole('button', { name: '查看原始合同' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.queryByTestId('raw-contract-json')).toBeNull();
  });
});
