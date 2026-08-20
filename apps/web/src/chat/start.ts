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

/** 解析聊天的起始实体 rel(sitemap 词级交集 + 可达探测;兜底 articles)。 */
export async function resolveStartRel(
  baseUrl: string,
  goal: AgentGoal,
  fetchImpl: FetchLike,
): Promise<string> {
  try {
    const response = await fetchImpl(`${baseUrl}/.well-known/ui4a.json`);
    if (!response.ok) return DEFAULT_START_REL;
    const sitemap = (await response.json()) as { surfaces?: SitemapSurface[] };
    const surfaces = sitemap.surfaces ?? [];
    const text = goalText(goal);

    for (const surface of surfaces) {
      const label = `${surface.rel} ${surface.title ?? ''}`;
      if (!overlaps(text, label)) continue;
      const probe = await fetchImpl(`${baseUrl}/api/entity?rel=${encodeURIComponent(surface.rel)}`);
      // 消费 body 后再释放(Response 缓冲无副作用;仅探测状态码)。
      await probe.arrayBuffer().catch(() => undefined);
      if (probe.ok) return surface.rel;
    }
    return DEFAULT_START_REL;
  } catch {
    return DEFAULT_START_REL; // 机械层兜底:合同不可读也能从入口集合起步
  }
}
