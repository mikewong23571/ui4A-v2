/**
 * 词级匹配:rule driver 的目标相关性判定原语(arch-brief §5)。
 *
 * 刻意不引入重量级 NLP:
 * - ascii 词元分词 + 相等匹配(不是子串!publish 不匹配 republish——
 *   「下线」目标不得误配 republish);
 * - 中文按字符包含(≥2 字的连续串);中英双语经小型动词词表桥接
 *   (目标中文「下线」、动作名英文 unpublish 是种子域的常态)。
 */

/** 双语动词词表:目标动词 → 动作词候选(确定性,无链式展开)。 */
const VERB_LEXICON: Readonly<Record<string, readonly string[]>> = {
  发布: ['publish'],
  上线: ['publish', 'republish'],
  创建: ['create'],
  新建: ['create'],
  下线: ['unpublish', 'offline'],
  下架: ['unpublish', 'offline'],
  撤下: ['unpublish'],
  归档: ['archive'],
  审核: ['approve', 'moderate', 'review'],
  处理: ['approve', 'moderate'],
  通过: ['approve'],
  批准: ['approve', '确认'],
  确认: ['approve', '批准'],
  驳回: ['reject'],
  拒绝: ['reject'],
};

const ASCII_WORD_PATTERN = /[a-z0-9]+/g;
const CJK_RUN_PATTERN = /[\u4e00-\u9fff]+/g;

/** ascii 词元(小写;连字符/斜杠等一律切分)。 */
export function asciiTokens(input: string): string[] {
  return input.toLowerCase().match(ASCII_WORD_PATTERN) ?? [];
}

/** 连续中文串(整体作为包含匹配的候选)。 */
export function cjkRuns(input: string): string[] {
  return input.match(CJK_RUN_PATTERN) ?? [];
}

function isAsciiWord(token: string): boolean {
  return /^[a-z0-9]+$/.test(token);
}

/**
 * 词元是否命中目标串:ascii 词元要求分词后相等;中文串(≥2 字)要求包含。
 */
export function tokenInString(token: string, target: string): boolean {
  const lowered = target.toLowerCase();
  if (isAsciiWord(token)) {
    return asciiTokens(lowered).includes(token);
  }
  return token.length >= 2 && lowered.includes(token);
}

/** 任一词元命中即真。 */
export function anyTokenInString(tokens: readonly string[], target: string): boolean {
  return tokens.some((token) => tokenInString(token, target));
}

/**
 * 动词展开:原词元 + 命中的词表键与其英文动作词。
 * 例:「下线」→ [下线, unpublish, offline];「审核所有待处理评论」→ […, 审核, approve, …]。
 */
export function expandVerb(verb: string): string[] {
  const expanded = new Set<string>();
  for (const token of asciiTokens(verb)) {
    expanded.add(token);
  }
  for (const run of cjkRuns(verb)) {
    if (run.length >= 2) expanded.add(run);
  }
  for (const [key, extras] of Object.entries(VERB_LEXICON)) {
    const hit = isAsciiWord(key) ? asciiTokens(verb).includes(key) : verb.includes(key);
    if (!hit) continue;
    expanded.add(key);
    for (const extra of extras) {
      expanded.add(extra);
    }
  }
  return [...expanded];
}

/** 词级交集(双向展开;rule driver 的动作/资源匹配统一入口)。 */
export function overlaps(a: string, b: string): boolean {
  return anyTokenInString(expandVerb(a), b) || anyTokenInString(expandVerb(b), a);
}
