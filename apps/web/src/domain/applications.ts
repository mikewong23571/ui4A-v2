/** 测试/fixture 兼容门面；application 定义来自 JSON 应用制品。 */
import type { ApplicationDefinition } from '@ui4a/shared';

import { walkthroughApplicationBundle } from '../applications/bundles';

export const businessApplicationList: readonly ApplicationDefinition[] =
  walkthroughApplicationBundle.applications;

function application(name: string): ApplicationDefinition {
  const found = businessApplicationList.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`walkthrough 应用制品缺 application "${name}"`);
  return found;
}

export const defaultApplication = application('default');
export const publishingApplication = application('publishing');
export const communityApplication = application('community');
