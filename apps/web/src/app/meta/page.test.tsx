// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import DefinitionManagementPage, { metadata } from './page';

afterEach(cleanup);

describe('定义管理入口文案', () => {
  it('导航目标标题使用人类可读名称,BIOS 仅作为解释性内部别名', () => {
    render(<DefinitionManagementPage />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('定义管理');
    expect(screen.getByText(/内部名称：BIOS/)).toBeTruthy();
    expect(metadata.title).toBe('定义管理 · UI4A');
  });
});
