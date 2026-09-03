# Track: T48 Application Genesis 产品内闭环与 Meta 人机同门

- 类型:feature
- 状态:new(2026-09-04)
- 章程:[spec.md](./spec.md) — 目标、D66/D67 设计决定、US1–US8、非目标与验收标准
- 执行:[plan.md](./plan.md) — Phase 0–7,TDD 任务序列
- 元数据:[metadata.json](./metadata.json)

## 一句话

application 的定义级出生走产品内受治理 Draft 环(application-bundle kind → 原子
seed 事件 → scope 全集自动生长 → 治理凭证立即可达);meta 站点对人类暴露与 agent
同一份 Siren 合同的定义级操作(集合级 create 渲染、人类编辑器、flow genesis)。

## 规划裁定记录(自治协议代行)

- genesis 必须 bootstrap 化(用户 2026-09-04 裁定):激活即追加与启动 bootstrap 同种
  事件,receipt 幂等,重放一致;
- 人机同门(用户 2026-09-04 裁定):T39 北极星"人类主路径不含创建入口"修订,
  零 AI 与合同驱动约束不变;
- D66.4 治理展开触发词选 `governance`(既有安装应用,零新词表);专用
  `ui4a:operator` 词表为已考虑的替代方案,多租户需要时再立决定;
- D65(CLI --scope)为本 track 前置,Phase 0 先行提交,避免历史混杂。
