// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { MetaEntityPage } from './meta-entity-page';
import type { MetaEntityState } from './meta-client';

// G02b(T54/D73):Meta 实体读取失败的三态分型 + 稳定回执宿主 + 目录/返回出口。
// 403 族(application_deprecated / scope_insufficient)不得渲染为「服务不可用」。
const entityState: Partial<MetaEntityState> = {};
const metaEntity = vi.hoisted(() => ({ useMetaEntity: vi.fn() }));

vi.mock('./meta-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./meta-client')>();
  return {
    ...actual,
    useMetaSitemap: () => ({
      state: 'ready',
      sitemap: { version: 'v-fixture', surfaces: [], applications: [] },
    }),
    useMetaEntity: metaEntity.useMetaEntity,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage(errorCode?: string) {
  metaEntity.useMetaEntity.mockReturnValue({
    entity: null,
    state: 'error',
    ...(errorCode === undefined ? {} : { errorCode }),
    refresh: () => undefined,
  } satisfies MetaEntityState);
  return render(<MetaEntityPage rel="meta/application:editorial" navigation={{}} />);
}

it('application_deprecated → 「应用已停用」,不出现「服务不可用」,有目录/返回出口', () => {
  renderPage('application_deprecated');
  expect(screen.getByRole('heading', { name: '应用已停用,不再可访问' })).toBeTruthy();
  expect(screen.queryByText(/服务不可用/)).toBeNull();
  expect(screen.getByRole('link', { name: '应用目录' }).getAttribute('href')).toContain(
    'meta%2Fapplications',
  );
  expect(screen.getByRole('button', { name: '返回上一页' })).toBeTruthy();
});

it('scope_insufficient → 「当前授权无权访问」,同样不是服务故障', () => {
  renderPage('scope_insufficient');
  expect(screen.getByRole('heading', { name: '当前授权无权访问此合同' })).toBeTruthy();
  expect(screen.queryByText(/服务不可用/)).toBeNull();
});

it('无结构化码(网络/5xx)→ 维持「服务不可用」诚实呈现', () => {
  renderPage(undefined);
  expect(screen.getByRole('heading', { name: '读取合同失败' })).toBeTruthy();
  expect(screen.getByText(/服务不可用/)).toBeTruthy();
});
