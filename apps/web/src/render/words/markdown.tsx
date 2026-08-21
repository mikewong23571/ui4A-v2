'use client';
/**
 * markdown 词条(T7 Phase B / 选型 §6):react-markdown 渲染实体正文。
 *
 * - entity = 实体引用的解引用结果;正文来自实体字段(fields.body,
 *   回退 fields.content/content——正文零 AI,词条只做渲染);
 * - 结构(标题/加粗/列表)来自实体数据本身,词条不发明任何内容。
 */
import ReactMarkdown from 'react-markdown';

import { asEntity, type WordProps } from './shared';

/** 正文取值:fields.body → fields.content → content(标量;缺即抛)。 */
function contentOf(entity: ReturnType<typeof asEntity>): string {
  const candidates = [
    (entity.properties.fields as Record<string, unknown> | undefined)?.body,
    (entity.properties.fields as Record<string, unknown> | undefined)?.content,
    entity.properties.content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate;
  }
  throw new Error('词条 markdown 的 entity 缺正文字段(fields.body / fields.content / content)');
}

export function MarkdownWord(props: WordProps) {
  const entity = asEntity(props.entity, 'markdown', 'entity');
  return (
    <article data-word="markdown" className="prose-sm w-full max-w-none text-zinc-800 [&_h1]:text-xl [&_h1]:font-semibold [&_strong]:font-semibold">
      <ReactMarkdown>{contentOf(entity)}</ReactMarkdown>
    </article>
  );
}
