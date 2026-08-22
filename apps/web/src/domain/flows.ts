/**
 * 测试/fixture 兼容门面。业务定义来自版本化 JSON 应用制品；生产 service 不导入本模块。
 */
import type { FlowDefinition } from '@ui4a/engine';

import { walkthroughApplicationBundle } from '../applications/bundles';

export const businessFlowList: readonly FlowDefinition[] = walkthroughApplicationBundle.flows;
export const businessFlows: Readonly<Record<string, FlowDefinition>> = Object.fromEntries(
  businessFlowList.map((flow) => [flow.name, flow]),
);

function flow(name: string): FlowDefinition {
  const found = businessFlows[name];
  if (found === undefined) throw new Error(`walkthrough 应用制品缺 flow "${name}"`);
  return found;
}

export const articleDraftingFlow = flow('article-drafting');
export const postStatusFlow = flow('post-status');
export const commentModerationFlow = flow('comment-moderation');
