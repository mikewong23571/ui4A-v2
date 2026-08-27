import { describe, expect, it } from 'vitest';

import { hrefToRel } from './contract-href';

// T32 Q8:合同 href → rel 的唯一实现(此前 entity-view 与 render/words/detail
// 各持一份手工同步副本)。只认 /api/entity?rel=… 形状的查询参数。

describe('hrefToRel', () => {
  it('提取已编码的 rel 并还原空格', () => {
    expect(hrefToRel('/api/entity?rel=post%3Afirst-post')).toBe('post:first-post');
    expect(hrefToRel('/api/entity?rel=a+b')).toBe('a b');
  });

  it('rel 不在首位或伴随其他参数时仍可提取', () => {
    expect(hrefToRel('/api/entity?scope=publishing&rel=articles')).toBe('articles');
    expect(hrefToRel('/api/entity?rel=articles&scope=publishing')).toBe('articles');
  });

  it('无 rel 参数或无查询串时返回 null(不伪造)', () => {
    expect(hrefToRel('/api/exec')).toBeNull();
    expect(hrefToRel('/api/entity?scope=publishing')).toBeNull();
    expect(hrefToRel('')).toBeNull();
  });
});
