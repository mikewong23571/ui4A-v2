/**
 * render 意图 → spec 生成器(T7 Phase C / spec 架构决定 4:S5 的生成路径)。
 *
 * 与 rule driver 同族的确定路径:纯函数、词级匹配、零 LLM 依赖(I1)。
 * - 意图词级匹配:展示/图表词 + 双语名词词表(文章→articles)命中 sitemap
 *   集合面 → chart(带维度词)/table 词条 spec;
 * - 零字面:bind 只产引用节点(collection+dimension),维度引用真实字段
 *   (字段名必须在 sitemap 流程节点声明中出现——"事实不可发明",解引用器
 *   对假字段响亮失败是第二道闸);
 * - 维度路径 `<collection>.fields.<name>`:实体投影把实例字段嵌在
 *   properties.fields 下(engine siren 口径),dimension 是成员级 field-ref;
 * - 凝固路径:同 concern 已凝固 → 直接复用首冻 spec(同一关注点永远同一
 *   布局;首冻由 web 侧 freezeSpec 落 render-spec-frozen 事件);
 * - 未命中(非展示意图/集合不在 sitemap/维度字段未声明)→ undefined,
 *   交回普通 agent 循环——不猜、不半吊子。
 *
 * LLM 路径接口:buildRenderPrompt(词汇表+sitemap 处境披露)+ parseRenderResponse
 * (fail-safe JSON 提取;零字面/词条形状的最终把关在 freezeSpec 入口,
 * web 侧校验器——分层把关,不在本包重复)。
 */
import { asciiTokens } from './match';

// ---- 类型 --------------------------------------------------------------------

/**
 * 生成的渲染说明(结构上即 web 侧 RenderSpec:concern/component/bind;
 * bind 的零字面与词条形状由 web 入口校验器把关,本包只产引用树)。
 */
export interface GeneratedRenderSpec {
  /** 关注点键(凝固键:同 concern 永远同一布局)。 */
  concern: string;
  /** 词汇表词名(chart/table/…;取值域见 /api/render/catalog)。 */
  component: string;
  /** 绑定树(零字面:只有引用节点与结构容器)。 */
  bind: Record<string, unknown>;
}

/** 已凝固 spec 条目(engine listFrozenSpecs 的结构子集;凝固路径数据源)。 */
export interface FrozenSpecEntry {
  concern: string;
  component: string;
  bind: unknown;
}

/**
 * sitemap 的结构子集(engine Sitemap 可直接代入):集合面 + 流程节点字段
 * 声明(维度字段的真实性依据)。
 */
export interface RenderSitemapContext {
  surfaces: readonly { rel: string; title: string; collection?: boolean }[];
  flows: readonly {
    name: string;
    title?: string;
    nodes: readonly { name: string; fields?: readonly { name: string }[] }[];
  }[];
}

// ---- 词表(双语,与 match.ts 的 VERB_LEXICON 同风格)--------------------------

/** 展示类意图词(命中其一才进生成路径;否则交回普通循环)。 */
const DISPLAY_TOKENS = [
  '展示',
  '显示',
  '列出',
  '列表',
  '看看',
  '查看',
  '可视化',
  '图表',
  'show',
  'list',
  'view',
  'chart',
  'graph',
  'table',
] as const;

/** 名词词表:中文集合名 → 集合 rel(ascii 名直接与 surface rel 词元匹配)。 */
const NOUN_LEXICON: Readonly<Record<string, string>> = {
  文章: 'articles',
  评论: 'comments',
};

/** 维度词表:分类词 → 维度字段名(字段须在 sitemap 流程声明)。 */
const DIMENSION_LEXICON: Readonly<Record<string, string>> = {
  分类: 'category',
  类别: 'category',
  category: 'category',
};

// ---- 词级匹配原语 ------------------------------------------------------------

function tokenInString(token: string, target: string): boolean {
  if (/^[a-z0-9]+$/.test(token)) return asciiTokens(target).includes(token);
  return token.length >= 2 && target.includes(token);
}

// ---- 生成路径 ----------------------------------------------------------------

/** 意图命中的集合 rel(sitemap 集合面 + 双语名词词表;未命中 undefined)。 */
function collectionOf(intent: string, sitemap: RenderSitemapContext): string | undefined {
  const collections = sitemap.surfaces
    .filter((surface) => surface.collection === true)
    .map((surface) => surface.rel);
  if (collections.length === 0) return undefined;
  // ascii 词元:show articles → 'articles'(集合 rel 去尾 s 的单数同样命中)。
  const tokens = asciiTokens(intent);
  const byAscii = collections.find(
    (rel) => tokens.includes(rel) || tokens.includes(rel.replace(/s$/, '')),
  );
  if (byAscii !== undefined) return byAscii;
  // 中文名词:文章 → 'articles'(词表映射后仍须在 sitemap 集合面内)。
  const byLexicon = Object.entries(NOUN_LEXICON).find(([noun]) => intent.includes(noun));
  if (byLexicon === undefined) return undefined;
  return collections.includes(byLexicon[1]) ? byLexicon[1] : undefined;
}

/** 意图命中的维度字段名(词表命中 + sitemap 流程节点确有声明;否则 undefined)。 */
function dimensionFieldOf(intent: string, sitemap: RenderSitemapContext): string | undefined {
  const hit = Object.entries(DIMENSION_LEXICON).find(([word]) => tokenInString(word, intent));
  if (hit === undefined) return undefined;
  const field = hit[1];
  const declared = sitemap.flows.some((flow) =>
    flow.nodes.some((node) => (node.fields ?? []).some((entry) => entry.name === field)),
  );
  // sitemap 不携带 flow→collection 的 append 边,字段级验证以"全局声明过"为
  // 准;假字段在解引用器响亮失败(deref 对缺路径零容忍)——两道闸都不可绕。
  return declared ? field : undefined;
}

/**
 * rule 确定路径:意图 + sitemap + 已凝固清单 → 渲染说明(纯函数)。
 *
 * - 维度词命中且字段已声明 → chart(collection+dimension 聚合);
 * - 无维度词 → table(集合直列);
 * - 维度词命中但字段未声明 → undefined(用户点名了维度却无真实字段可引,
 *   如实拒绝交回普通循环——不静默降级,不发明字段);
 * - 已凝固同 concern → 复用首冻 spec(凝固语义,不重新生成);
 * - 非展示意图/集合未命中 → undefined(交回普通循环)。
 */
export function renderSpecFor(
  intent: string,
  sitemap: RenderSitemapContext,
  frozen: readonly FrozenSpecEntry[],
): GeneratedRenderSpec | undefined {
  if (!DISPLAY_TOKENS.some((token) => tokenInString(token, intent))) return undefined;
  const collection = collectionOf(intent, sitemap);
  if (collection === undefined) return undefined;
  const dimensionWordHit = Object.keys(DIMENSION_LEXICON).some((word) => tokenInString(word, intent));
  const dimensionField = dimensionFieldOf(intent, sitemap);
  if (dimensionWordHit && dimensionField === undefined) return undefined;

  const concern = dimensionField !== undefined
    ? `${collection}-by-${dimensionField}`
    : `${collection}-list`;
  const existing = frozen.find((entry) => entry.concern === concern);
  if (
    existing !== undefined &&
    typeof existing.bind === 'object' &&
    existing.bind !== null &&
    !Array.isArray(existing.bind)
  ) {
    // 凝固路径:复用首冻 spec(形状异常的凝固条目视同未凝固,交回生成——
    // 零字面/词条形状的把关仍在 freezeSpec 入口与渲染规划流)。
    return {
      concern: existing.concern,
      component: existing.component,
      bind: existing.bind as Record<string, unknown>,
    };
  }

  if (dimensionField !== undefined) {
    return {
      concern,
      component: 'chart',
      bind: { series: { collection, dimension: `${collection}.fields.${dimensionField}` } },
    };
  }
  return { concern, component: 'table', bind: { rows: { collection } } };
}

// ---- LLM 路径接口 -------------------------------------------------------------

/** prompt 用的词条摘要(目录 /api/render/catalog 的结构子集)。 */
export interface RenderWordSummary {
  name: string;
  description: string;
  bindSchema: Record<string, unknown>;
}

/** buildRenderPrompt 输入(处境披露:目标 + 集合面/字段声明 + 词汇表)。 */
export interface BuildRenderPromptInput {
  intent: string;
  sitemap: RenderSitemapContext;
  words: readonly RenderWordSummary[];
}

/**
 * 组装 render 生成的 LLM prompt(纯字符串;传输与模型选择由调用方负责)。
 * 约束:只输出 JSON;bind 零字面(只有 {collection[,dimension]}/{field}/{ref}
 * 引用节点);component 取自词汇表;concern 为 kebab-case 凝固键。
 */
export function buildRenderPrompt(input: BuildRenderPromptInput): string {
  const collections = input.sitemap.surfaces
    .filter((surface) => surface.collection === true)
    .map((surface) => surface.rel);
  const fields = [
    ...new Set(
      input.sitemap.flows.flatMap((flow) =>
        flow.nodes.flatMap((node) => (node.fields ?? []).map((field) => field.name)),
      ),
    ),
  ];
  const words = input.words
    .map((word) => `- ${word.name}:${word.description}\n  bindSchema: ${JSON.stringify(word.bindSchema)}`)
    .join('\n');
  return [
    `你是 UI4A 的 render capability:把用户的展示意图转成 binding-only 渲染说明(JSON)。`,
    `## 用户意图\n${input.intent}`,
    `## 可绑定集合(sitemap 集合面)\n${collections.join(', ') || '(无)'}`,
    `## 已声明字段(维度取值必须来自此处,不得发明字段)\n${fields.join(', ') || '(无)'}`,
    `## 渲染词汇表(目录 /api/render/catalog)\n${words}`,
    [
      '## 输出要求',
      '1. 只输出一个 JSON 对象,形状 {"concern":"<kebab-case>","component":"<词名>","bind":{…}},不要输出其他文字。',
      '2. bind 零字面:任何裸数值/字符串载荷都非法;只允许引用节点 {collection[,dimension]}、{field}、{ref} 与结构容器。',
      '3. component 必须取自上方词汇表;concern 是凝固键,同一关注点永远同一布局。',
      '4. 聚合图表(chart)的 series 绑定 {collection, dimension:"<collection>.fields.<字段名>"},维度字段必须已声明。',
    ].join('\n'),
  ].join('\n\n');
}

/**
 * 解析 LLM 的 render 回复(fail-safe:任何不合法输出都返回 undefined,
 * 绝不抛异常)。零字面与词条形状的最终把关在 freezeSpec 入口(web 校验器)。
 */
export function parseRenderResponse(text: string): GeneratedRenderSpec | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced !== null ? fenced[1]! : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!candidate.trim().startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (typeof record.concern !== 'string' || record.concern === '') return undefined;
  if (typeof record.component !== 'string' || record.component === '') return undefined;
  if (typeof record.bind !== 'object' || record.bind === null || Array.isArray(record.bind)) {
    return undefined;
  }
  // 断言理由:上方已排除 null/数组,object 即 JSON 对象(Record 收窄)。
  return {
    concern: record.concern,
    component: record.component,
    bind: record.bind as Record<string, unknown>,
  };
}
