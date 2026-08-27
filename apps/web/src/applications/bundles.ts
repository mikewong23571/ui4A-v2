/** 生产内置应用制品清单；本模块只做 unknown JSON → meta 安装合同解析。 */
import { parseApplicationBundle, type ApplicationBundle } from '@ui4a/engine';

import ideasArtifact from './ideas.bundle.json';
import todoArtifact from './todo.bundle.json';
import walkthroughArtifact from './ui4a-walkthrough.bundle.json';

export const walkthroughApplicationBundle = parseApplicationBundle(walkthroughArtifact);

export const todoApplicationBundle = parseApplicationBundle(todoArtifact);

export const ideasApplicationBundle = parseApplicationBundle(ideasArtifact);

export const installedApplicationBundles: readonly ApplicationBundle[] = [
  walkthroughApplicationBundle,
  todoApplicationBundle,
  ideasApplicationBundle,
];
