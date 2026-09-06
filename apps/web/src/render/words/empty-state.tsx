'use client';

import type { CognitiveSemanticsEmptyMeaning } from '@ui4a/shared';

import { asRequiredString, type WordProps } from './shared';

const COPY: Readonly<Record<CognitiveSemanticsEmptyMeaning, string>> = {
  // D78 决定 3:裁剪与真空在合同上同形,空态文案必须保持「可见」口径,
  // 不得作「当前没有/无任何」类全称断言。
  'no-current-responsibility': '当前可见范围没有需要你处理的事项。',
  'nothing-in-motion': '当前可见列表没有进行中的事项。',
  'no-results': '没有符合当前条件的结果。',
  'ready-to-start': '这里还没有内容，可以使用本页的主要任务开始。',
};

export function EmptyStateWord(props: WordProps) {
  const meaning = asRequiredString(props.meaning, 'empty-state', 'meaning');
  const copy = COPY[meaning as CognitiveSemanticsEmptyMeaning];
  if (copy === undefined) throw new Error(`词条 empty-state 不支持语义 ${meaning}`);
  return (
    <p data-word="empty-state" role="status" className="py-2 text-sm text-muted-foreground">
      {copy}
    </p>
  );
}
