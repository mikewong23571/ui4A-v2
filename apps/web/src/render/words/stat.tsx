'use client';
/**
 * stat 词条(T9 Phase D):shadcn Card 自绘统计卡渲染单值(Tremor 已退出)。
 *
 * - value/label = 字段引用的解引用结果(数值来自实体快照,模型发不出
 *   一个数字——渲染数字必与实体一致,主页态势的对拍锚点);
 * - 大数字 + muted 标签,全部走语义令牌(bg-card/text-muted-foreground),
 *   深色经 globals.css 媒体查询翻转可读。
 */
import { Card } from '@/components/ui/card';

import { asOptionalString, asStatValue, type WordProps } from './shared';

export function StatWord(props: WordProps) {
  const value = asStatValue(props.value, 'stat', 'value');
  const label = asOptionalString(props.label, 'stat', 'label');

  return (
    <Card data-word="stat" className="min-w-40 gap-1 p-4">
      {label !== undefined && <p className="text-xs text-muted-foreground">{label}</p>}
      <p className="text-2xl font-semibold tabular-nums">{String(value)}</p>
    </Card>
  );
}
