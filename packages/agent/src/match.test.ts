/**
 * 词级匹配单测(T2 Phase D / Task D2):
 * - ascii 词元相等匹配(publish ≠ republish,避免 unpublish/republish 误配);
 * - 中文按字符包含(≥2 字);双语动词词表展开(发布→publish 等);
 * - 词表是 rule driver 的双语桥:目标中文、动作名英文时的确定性匹配。
 */
import { describe, expect, it } from 'vitest';

import { expandVerb, overlaps } from './match';

describe('overlaps(词级交集)', () => {
  it('ascii 词元相等才匹配:publish 不匹配 republish', () => {
    expect(overlaps('publish', 'republish')).toBe(false);
    expect(overlaps('unpublish', 'unpublish')).toBe(true);
    expect(overlaps('unpublish', 'Unpublish Article')).toBe(true);
  });

  it('连字符词分词:title-not-taken 与 title 有交集', () => {
    expect(overlaps('title-not-taken', 'title')).toBe(true);
  });

  it('中文包含(≥2 字):发布 匹配 发布文章;发布 不匹配 审核', () => {
    expect(overlaps('发布', '发布文章')).toBe(true);
    expect(overlaps('发布文章', '发布')).toBe(true);
    expect(overlaps('发布', '审核')).toBe(false);
  });

  it('混合双语:经词表展开后 审核 匹配 approve', () => {
    expect(overlaps('审核', 'approve')).toBe(true);
    expect(overlaps('下线', 'unpublish')).toBe(true);
    expect(overlaps('发布', 'publish')).toBe(true);
    expect(overlaps('发布', 'unpublish')).toBe(false);
  });

  it('英文目标直配英文动作,无需词表', () => {
    expect(overlaps('publish', 'publish')).toBe(true);
    expect(overlaps('offline it', 'offline')).toBe(true);
  });
});

describe('expandVerb(动词词表展开)', () => {
  it('中文动词展开出英文动作词', () => {
    expect(expandVerb('下线')).toEqual(expect.arrayContaining(['下线', 'unpublish', 'offline']));
    expect(expandVerb('发布一篇文章')).toEqual(expect.arrayContaining(['发布', 'publish']));
    expect(expandVerb('审核所有待处理评论')).toEqual(
      expect.arrayContaining(['审核', 'approve', 'moderate', 'review']),
    );
  });

  it('英文动词保持原样', () => {
    expect(expandVerb('unpublish')).toContain('unpublish');
  });
});
