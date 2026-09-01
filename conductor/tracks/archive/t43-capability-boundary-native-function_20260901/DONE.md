# T43 Application Capability Boundary — DONE

T43 已完成。UI4A 现在把 Capability 作为 Application 面向外部执行环境的 Port，并提供首个受治理的
Native Function Adapter，而没有把 Function 平台、Temporal 或 handler 机制暴露为产品概念。

## Delivered

- strict Profile / invocation / outcome / receipt wire，以及 bounded schema/binding/input/output contracts；
- executor-class dispatch：Agent 继续使用 canonical Agent Run，Function 不创建新 Run；
- `spawn-requested` birth/outbox、确定性 Workflow identity、boot/周期 reconciliation；
- Worker registry + Temporal Activity/Workflow，birth-pinned limits、retry、crash recovery、cancel/finalize；
- protected callback ingress，当前状态重新裁决，capability receipt + core events 单事务幂等提交；
- trusted-only internal callbacks、D51 audit filtering、Governed Draft registry parity 与 same-source artifact refs；
- Security Application `cve.enrich` 真实切片、Work Thread/CLI/Assistant/UI/raw audit 和第二
  `document.normalize` 扩展证明。

## Acceptance

- S1–S14 全部 PASS，Safety stories 100%；真实 Assistant Eval 2/2。
- Principal Review 的 Critical/High/Medium findings 全部闭环；见 `review.md`。
- `pnpm check` 最终 exit 0；strict governance 无例外。
- 独立 Temporal 下 `CI=true pnpm e2e`：67 passed、26 environment-gated skipped、0 failed。
- real Temporal durability：2/2；I5 replay：68 events、40 rels、hash `342412cf4f50` 一致。
- 开发栈恢复并验证 readiness=`ready`、db=`ok`。

未完成方向是远端网络 Adapter、side-effect Function 的独立幂等协议和 hard CPU/memory sandbox；它们没有
被 T43 的 local pure transform/extract Adapter 冒充。
