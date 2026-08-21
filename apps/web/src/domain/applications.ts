/**
 * application seed 常量(T10 Phase B Task 1;spec 架构决定 1/2/7)——
 * 与 flows.ts 同地位:seed 源 + 类型来源,不是运行时真相源:
 * - boot 时若日志无某 application 的 application-seeded 事件,常量全文入日志
 *   (seeded 即 active;fold 落 snapshot.applications 表,见 engine/service.ts
 *   的 seedBootData 与 engine/fold.ts 的 applyApplicationSeeded);
 * - application 不持成员清单(架构决定 2:避免双重真相)——membership 由
 *   flow.app 声明、推导时聚合;本文件的 intent 是发现层两层发现的第一层依据
 *   (agent 先按 intent 定位 app,再在 app 内选 flow)。
 *
 * 三个 seed 支撑架构决定 7 的"≥2 个语义 app"口径:
 * - default:归一化兜底(parse 缺省 app='default' 的落点);seed 保证其始终
 *   激活——这是 app-known 不变式长牙的地板(未声明归属的 flow 永远有处可落);
 * - publishing:内容起草与发布(成员 = article-drafting、post-status);
 * - community:评论与社区互动(成员 = comment-moderation)。
 *
 * 常量在模块加载时经 parseApplicationDefinition 校验——非法定义在此处
 * 就响亮失败(与 flow 常量同口径)。
 */
import { parseApplicationDefinition } from '@ui4a/engine';
import type { ApplicationDefinition } from '@ui4a/shared';

/** 归一化兜底桶:不承载具体业务语义,保证每个 flow 都有合法归属。 */
export const defaultApplication: ApplicationDefinition = parseApplicationDefinition({
  name: 'default',
  title: '默认应用',
  intent:
    '归一化兜底:未显式声明归属的 flow 统一落在这里(parse 缺省 app=default)。' +
    'boot seed 保证其始终激活,是 app-known 不变式的地板——不承载具体业务语义。',
});

/** 内容域:从起草到发布后的全生命周期。 */
export const publishingApplication: ApplicationDefinition = parseApplicationDefinition({
  name: 'publishing',
  title: '内容发布',
  intent: '内容起草与发布:三步向导起草文章并发布,发布后管理其状态(下线/归档/重新发布)。',
});

/** 社区域:读者互动的审核队列。 */
export const communityApplication: ApplicationDefinition = parseApplicationDefinition({
  name: 'community',
  title: '社区互动',
  intent: '评论与社区互动:读者评论进入审核队列,经人工裁决通过或驳回。',
});

/** 种子 application 列表(声明序 = boot 入日志序;default 恒在首位)。 */
export const businessApplicationList: readonly ApplicationDefinition[] = [
  defaultApplication,
  publishingApplication,
  communityApplication,
];
