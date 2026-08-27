/**
 * 从合同 href 提取 rel(T32 Q8 提取的唯一实现;此前 entity-view 与
 * render/words/detail 各持一份手工同步副本)。只认 /api/entity?rel=…;
 * 其余 href 无 rel 可提,返回 null,不伪造。
 */
export function hrefToRel(href: string): string | null {
  const query = href.split('?')[1] ?? '';
  const match = /(?:^|&)rel=([^&]*)/.exec(query);
  return match === null ? null : decodeURIComponent(match[1].replace(/\+/g, ' '));
}
