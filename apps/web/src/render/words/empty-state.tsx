'use client';

import type { CognitiveSemanticsEmptyMeaning } from '@ui4a/shared';

import { asRequiredString, type WordProps } from './shared';

const COPY: Readonly<Record<CognitiveSemanticsEmptyMeaning, string>> = {
  'no-current-responsibility': '当前没有需要你处理的事项。',
  'no-results': '没有符合当前条件的结果。',
  'ready-to-start': '这里还没有内容，可以使用本页的主要任务开始。',
};

export function EmptyStateWord(props: WordProps) {
  const meaning = asRequiredString(props.meaning, 'empty-state', 'meaning');
  const copy = COPY[meaning as CognitiveSemanticsEmptyMeaning];
  if (copy === undefined) throw new Error(`词条 empty-state 不支持语义 ${meaning}`);
  return (
    <p
      data-word="empty-state"
      role="status"
      className="rounded-md border border-dashed p-3 text-sm"
    >
      {copy}
    </p>
  );
}
