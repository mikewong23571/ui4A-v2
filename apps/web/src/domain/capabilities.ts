/** 测试/fixture 兼容门面；capability 定义来自 JSON 应用制品。 */
import type { CapabilityDefinition } from '@ui4a/shared';

import { walkthroughApplicationBundle } from '../applications/bundles';

export const businessCapabilityList: readonly CapabilityDefinition[] =
  walkthroughApplicationBundle.capabilities;

function capability(name: string): CapabilityDefinition {
  const found = businessCapabilityList.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`walkthrough 应用制品缺 capability "${name}"`);
  return found;
}

export const draftCapability = capability('draft');
export const summarizeCapability = capability('summarize');
export const notifyCapability = capability('notify');
export const clarifyCapability = capability('clarify');
