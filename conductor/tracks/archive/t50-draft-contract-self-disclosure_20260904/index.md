# Track: T50 定义提案合同自披露

- 类型:feature
- 状态:new(2026-09-04)
- 章程:[spec.md](./spec.md) — G1–G4、D69 设计决定、US1–US5、非目标与验收
- 执行:[plan.md](./plan.md) — Phase 0–7,TDD 任务序列
- 元数据:[metadata.json](./metadata.json)

## 一句话

定义提案的 payload 期望形状进合同(action 字段 `x-ui4a-payload-schemas` 注解,人/
AI/CLI 同门可读),形状类拒绝携带结构化 `expected` 数据(非友好模板),target 裸名
守卫补漏,CLI `drafts schema` 语法糖——外置 Agent 从"12 版盲试+问人"变为
"读合同一步构造"。

## 规划裁定记录(自治协议代行,经用户会话逐轮确认)

- **落位裁定**:schema 放 action `fields` 的 payload 注解,不放 CLI(第二真相源会
  漂移)也不放 entity properties(chat 的 summarizeEntity 摘要层会丢弃)——依据
  product-vision §二"同一扇门,两个读者"与 §八"不窄化 HTTP 合同";
- **文案滑梯修正**(product-vision §六):"错误消息内联期望形状"修正为"拒绝携带
  结构化 expected 数据,机械 message 不动,人话归各门(LLM 原生/CLI 原样/浏览器结构化)";
- **有界 schema**:结构层+seed 条目形状,深层开放;跨字段引用留给服务端裁决+expected
  数据(理念 3 分层披露,防 300KB prompt 复辟);
- 起源证据:ui4a-ops GAP-3(12 版盲试实录)与 GAP-4(前缀绕过守卫,Draft
  0788c0d6e007183375d0 已 abandon 留痕);
- 验收含步数对照(≤2 次迭代 vs 基线 12 次)与愿景四条评审。
