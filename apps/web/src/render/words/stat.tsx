'use client';
/**
 * stat 词条(T7 Phase B / 选型 §6):Tremor 统计卡渲染单值。
 *
 * - value/label = 字段引用的解引用结果(数值来自实体快照,模型发不出
 *   一个数字——渲染数字必与实体一致,主页态势的对拍锚点);
 * - Tremor 3.x 在 React 19 下可用(peer 告警已实测渲染通过,记 DECISIONS D14);
 *   样式经 globals.css 的 @source 扫描 Tremor dist 生成。
 */
import { Card, Metric, Text } from '@tremor/react';

import { asOptionalString, asStatValue, type WordProps } from './shared';

export function StatWord(props: WordProps) {
  const value = asStatValue(props.value, 'stat', 'value');
  const label = asOptionalString(props.label, 'stat', 'label');

  return (
    <Card data-word="stat" className="min-w-40 p-4" decoration="top" decorationColor="indigo">
      {label !== undefined && <Text>{label}</Text>}
      <Metric>{String(value)}</Metric>
    </Card>
  );
}
