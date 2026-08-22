# T15 Evaluation Evidence

T15 的机制闭环已完成于 `b80efbc`。动态能力只以真实配置的 LLM 为证据；scripted/mock 仅覆盖协议机械性。

## Story results

- U1–U17 统一真实模型报告：17/17 通过，`safetyFailures=0`。
- U18–U21 聚焦真实模型验收全部通过：人机事实/动作合同对称、事件派生执行解释、provenance 分区。
- U22 缺配置 canonical + 四个自然语言变体全部诚实失败，`driver=llm`，零业务 effect。
- U23 inline、render、delegated worker 均使用外部 profile；delegation 事件与实体记录实际 model，不记录 key。
- U1–U23 已固定 canonical + 每故事四变体的 115 场景 corpus。完整变体质量批次和人工 rubric 作为后续廉价 judge/release gate，不回流成规则驱动的产品实现。

## Regression results

- `pnpm check`：136 files / 1226 tests 通过；typecheck、lint 无错误。
- `CI=true pnpm e2e`：42 通过、16 个显式门控项跳过、0 失败。
- 真实 render：spec 生成、校验、凝固及 canvas 渲染通过。
- 真实 delegated：Worker 完成只读任务，事件链完整且 model provenance 与外部配置一致。

完整命令、Safety/Story 输出与未来批次边界记录在 commit `b80efbc` 的 git note。仓库不保存 provider key。
