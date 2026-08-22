/** 测试/fixture 兼容门面；初始实体与集合来自 JSON 应用制品。 */
import type { SeedDetail } from '@ui4a/engine';

import { walkthroughApplicationBundle } from '../applications/bundles';

export const SEED_REL = walkthroughApplicationBundle.seed.rel;
export const seedDetail: SeedDetail = walkthroughApplicationBundle.seed.detail;
