/** 生产内置应用制品清单；本模块只做 unknown JSON → meta 安装合同解析。 */
import { parseApplicationBundle, type ApplicationBundle } from '@ui4a/engine';

import walkthroughArtifact from './ui4a-walkthrough.bundle.json';

export const walkthroughApplicationBundle = parseApplicationBundle(walkthroughArtifact);

export const installedApplicationBundles: readonly ApplicationBundle[] = [walkthroughApplicationBundle];
