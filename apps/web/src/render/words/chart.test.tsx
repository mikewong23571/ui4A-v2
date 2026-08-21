// @vitest-environment jsdom
/**
 * chart 词条组件测试(T7 Phase B):给 deref 输出(维度聚合 [{key,count}])→
 * Recharts 柱状图:每个维度值一根柱,数值与聚合结果一致(I2 口径的对拍锚点)。
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { derefSpec } from '../deref';

import { articlesCache, specOf } from './fixtures';
import { ChartWord } from './chart';

afterEach(cleanup);

describe('chart 词条', () => {
  it('deref 输出 → 柱状图:维度标签与柱数与聚合一致', () => {
    const props = derefSpec(
      specOf('chart', {
        series: { collection: 'articles', dimension: 'articles.fields.category' },
      }),
      articlesCache(),
    );
    const { container } = render(<ChartWord {...props} />);

    // 维度标签(tech/essay 各一组,append 序)
    expect(container.textContent).toContain('tech');
    expect(container.textContent).toContain('essay');
    // 每组一根柱(recharts bar rectangle)
    expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2);
  });

  it('无障碍口径:aria 摘要含各维度计数(态势对拍锚点)', () => {
    const props = derefSpec(
      specOf('chart', {
        series: { collection: 'articles', dimension: 'articles.fields.category' },
      }),
      articlesCache(),
    );
    const { container } = render(<ChartWord {...props} />);
    const chart = container.querySelector('[data-word="chart"]');
    expect(chart?.getAttribute('aria-label')).toContain('tech=1');
    expect(chart?.getAttribute('aria-label')).toContain('essay=1');
  });

  it('series 非聚合数组 → 响亮抛错', () => {
    expect(() => render(<ChartWord series={{ collection: 'articles' }} />)).toThrow(
      /chart 的 series/,
    );
  });
});
