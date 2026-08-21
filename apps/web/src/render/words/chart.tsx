'use client';
/**
 * chart 词条(T9 Phase D):Recharts 柱状图渲染维度聚合计数(主题色走语义令牌)。
 *
 * - series = collection+dimension 的解引用结果([{key,count}]);
 * - 数值全部来自实体投影(I2 口径:DOM/aria 与快照对拍);
 * - aria-label 携带各维度计数(无障碍 + e2e 断言锚点)。
 */
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { asDimensionCounts, asOptionalString, type WordProps } from './shared';

export function ChartWord(props: WordProps) {
  const series = asDimensionCounts(props.series, 'chart', 'series');
  const caption = asOptionalString(props.caption, 'chart', 'caption');
  const ariaSummary = series.map((entry) => `${entry.key}=${entry.count}`).join(', ');

  return (
    <figure data-word="chart" className="w-full" aria-label={`维度计数:${ariaSummary}`}>
      {caption !== undefined && (
        <figcaption className="mb-2 text-sm font-semibold text-muted-foreground">
          {caption}
        </figcaption>
      )}
      {/* 固定尺寸(非 ResponsiveContainer):jsdom/SSR 零测量渲染,确定性输出 */}
      <BarChart
        width={480}
        height={260}
        data={series}
        margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="key" tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }} />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }}
          width={32}
        />
        <Bar dataKey="count" name="计数" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </figure>
  );
}
