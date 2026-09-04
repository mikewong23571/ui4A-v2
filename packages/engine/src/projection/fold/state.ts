/**
 * fold 产出快照的扩展状态(T52/D71.1)。
 *
 * EngineSnapshot 的规范形状在 @ui4a/shared(guard 谓词三方共用,依赖方向
 * shared ← engine);D71.1 的 deprecatedApplications 停用审计表定义于 engine
 * fold 层:接口向后兼容(可选字段,既有快照构造点/测试 fixture 无须改动),
 * fold 与 applyEffects 在场时随行携带。受众解析(P3,D71.3 双集查询)经
 * @ui4a/engine barrel 读该字段;若日后上移 shared,本类型可直接收编。
 */
import type { EngineSnapshot } from '@ui4a/shared';

/**
 * 停用应用审计条目(D71.1):name + 可选 reason。纯层无时钟——审计序号
 * 用事件 seq(日志层分配),不引入时间戳。
 */
export interface DeprecatedApplicationAudit {
  name: string;
  reason?: string;
  /** 停用事件 seq(审计定位用;键集成员关系不依赖它)。 */
  seq: number;
}

/** fold 产出快照:EngineSnapshot + deprecatedApplications 停用审计表。 */
export interface FoldSnapshot extends EngineSnapshot {
  /**
   * 停用应用审计集(D71.1):app 名 → 审计条目。键集即 D71.3 受众解析
   * 「active ∪ deprecated」双集查询的 deprecated 侧、D71.5 烧毁集的
   * deprecated 侧。与 applications 同口径:可选 + 仅在场时携带
   * (表不存在 = 空集语义,既有快照构造点类型兼容)。
   */
  deprecatedApplications?: Record<string, DeprecatedApplicationAudit>;
}
