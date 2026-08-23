// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import DefinitionManagementPage, { metadata } from './page';

afterEach(cleanup);

describe('定义管理入口文案', () => {
  it('导航目标是 sitemap 驱动的人类定义控制台', async () => {
    render(await DefinitionManagementPage());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('定义控制台');
    expect(screen.getByText(/Meta Human Control Plane/)).toBeTruthy();
    expect(metadata.title).toBe('定义控制台 · UI4A');
  });
});
