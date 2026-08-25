/**
 * T24 呈现诚实化:固定机制词表(纯常量清单)。
 *
 * 机制词 = 面向实现与合同层的词汇(渲染目录协商、surface/sidecar/deref、
 * 表面 ID 等)。它们属于「为什么这样展示」的解释信息,只允许出现在抽屉/
 * 诊断区;canvas 首屏与 chat 主区域的人类可读文本中禁现(用
 * `canvas-first-screen.test.tsx` 等断言)。canvas 与 chat 两侧都要复用,
 * 故置于 lib 而非某一组件目录。
 *
 * 施工纪律红线:本清单是固定常量——新增机制词直接追加字面量;禁止按
 * 应用/实体类型对清单做生成、过滤或分支(机制词表 = 固定常量清单)。
 */
export const MECHANISM_WORDS: readonly string[] = [
  // canvas 首屏头部机制行
  'A2UI',
  'surface 宿主',
  '目录 已协商',
  'catalog.json',
  // Sidecar 个人视图机制文案(词表先行收录;相关断言随后续任务追加)
  'sidecar:',
  '个人呈现',
  // deref 失败诊断词
  'deref-failed',
  // 表面 ID 特征(URL 编码的 presentation-<subject> 形态)
  'presentation-post%3A',
];
