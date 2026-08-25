/**
 * sitemap 感知的起始 rel 解析(arch-brief §6:LLM driver 的 prompt 构造以
 * "sitemap 前缀"起步;聊天路由作为合同客户端同样先读 sitemap)。
 *
 * 规则(词级交集 + 可达探测,纯客户端行为、零合同特权):
 * 1. GET /.well-known/ui4a.json;按 surfaces 声明序取与目标(verb/resource/
 *    targetRel)有词级交集的表面;
 * 2. 逐个探测 GET /api/entity(向导 flow 别名 200 可达;多实例 flow 404 跳过);
 * 3. 第一个可达的交集表面为 startRel;无交集或全部不可达/sitemap 不可得 →
 *    articles(种子域入口集合,runAgent 的缺省起点)。
 */
import { overlaps, type AgentGoal, type FetchLike } from '@ui4a/agent';

const DEFAULT_START_REL = 'articles';

interface SitemapSurface {
  rel: string;
  title?: string;
}

function goalText(goal: AgentGoal): string {
  return [goal.verb, goal.resource, goal.targetRel].filter(Boolean).join(' ');
}

/**
 * 定义面必须由用户显式意图进入,而显式意图就是用户当下所在的位置:
 * 站在 meta 控制台(/meta)或正在查看定义实体(canvas focus/roots 指向
 * meta/ rel)时,聊天回合在定义合同站(/_meta)进行;其余一律业务面。
 * 不从自然语言猜测意图(AI-first:理解归 LLM,平面归属只是客户端上下文
 * 事实)——正则启发式曾把"新增一篇文章…介绍操作流程"误判越界,agent 整
 * 回合困在 meta 平面导航循环(T22 生产实测)。
 */
export function metaPlaneFromClientRoute(route: string | undefined): boolean {
  if (route === undefined) return false;
  const pathname = route.split('?')[0]!;
  if (pathname === '/meta' || pathname.startsWith('/meta/')) return true;
  if (pathname !== '/canvas') return false;
  const params = new URLSearchParams(route.slice(route.indexOf('?') + 1));
  const subjects = [params.get('focus'), params.get('roots')].filter(
    (value): value is string => value !== null,
  );
  return subjects.some((value) => value.split(',').some((rel) => rel.startsWith('meta/')));
}

/**
 * 只表达“想处理某类事情”而未授权具体写动作时，只做发现/定位。避免把
 * “处理评论区”擅自解释为通过、驳回或批量修改。
 */
export function isDiscoveryOnlyIntent(verb: string): boolean {
  const discoveryShape =
    /(?:我想处理|带我处理|去处理|处理|帮我找).*(?:的事|相关|入口|在哪里|在哪儿)?[。！!？?]*$/i.test(
      verb.trim(),
    );
  const explicitMutation =
    /(?:^审核|通过|批准|驳回|拒绝|删除|发布|下线|归档|置顶|修改|新增|执行)/i.test(verb);
  return discoveryShape && !explicitMutation;
}

/** 解析聊天的起始实体 rel(sitemap 词级交集 + 可达探测;兜底 articles)。 */
export async function resolveStartRel(
  baseUrl: string,
  goal: AgentGoal,
  fetchImpl: FetchLike,
  defaultStartRel = DEFAULT_START_REL,
): Promise<string> {
  try {
    const response = await fetchImpl(`${baseUrl}/.well-known/ui4a.json`);
    if (!response.ok) return defaultStartRel;
    const sitemap = (await response.json()) as { surfaces?: SitemapSurface[] };
    const surfaces = sitemap.surfaces ?? [];
    const text = goalText(goal);

    // 先探测标题被目标完整点名的表面，再退化到词级交集；否则“文章状态”
    // 会因共享“文章”一词被更早的“文章发布向导”截走。
    const ordered = surfaces
      .map((surface, index) => ({
        surface,
        index,
        exactTitle:
          typeof surface.title === 'string' && surface.title !== '' && text.includes(surface.title),
      }))
      .sort(
        (left, right) =>
          Number(right.exactTitle) - Number(left.exactTitle) || left.index - right.index,
      )
      .map(({ surface }) => surface);

    for (const surface of ordered) {
      const label = `${surface.rel} ${surface.title ?? ''}`;
      if (!overlaps(text, label)) continue;
      const probe = await fetchImpl(`${baseUrl}/api/entity?rel=${encodeURIComponent(surface.rel)}`);
      // 消费 body 后再释放(Response 缓冲无副作用;仅探测状态码)。
      await probe.arrayBuffer().catch(() => undefined);
      if (probe.ok) return surface.rel;
    }
    return defaultStartRel;
  } catch {
    return defaultStartRel; // 机械层兜底:合同不可读也能从入口集合起步
  }
}
