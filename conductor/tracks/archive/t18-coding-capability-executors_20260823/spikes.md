# T18 Phase A Probe Record

## Red baseline

- `spawn-requested` is persisted but no generic executor registry or Temporal capability dispatch exists.
- Existing `delegationWorkflow` runs the UI4A Assistant contract loop; its state is rel/navigation/action
  oriented and cannot represent repository/workspace/patch/test/result semantics.
- Capability artifacts can be materialized only when output is already supplied on the initiating request;
  they are not produced by a durable external executor.
- No `capability-run` aggregate, raw/normalized executor event domain, workspace registry, Git lease,
  cancellation/resume handle, result acceptance or stale base decision exists.
- Current application bundle has publishing/community Flows only and no coding capability/node.

## Probe results

### Codex

- `codex exec --json --sandbox workspace-write --output-schema ...` 在 disposable repo 26.80s
  完成 edit + 2 tests，记录 thread/turn/command/file-change/agent-message/usage。
- `codex exec resume` 16.07s，以同一 thread 增补测试并通过 3 tests。
- `@openai/codex-sdk@0.149.0` 27.90s 完成独立 edit/test，提供 typed thread/resume/schema/
  AbortSignal/env；选为生产 adapter。
- SIGINT 无可靠 cancelled terminal event；UI4A 合成 cancel。空 auth 最终 `turn.failed(401)`，需 preflight。
- 默认个人配置带来约 93k–95k 输入 token；必须使用专用受控 executor environment。

### Claude compatibility

- 本机 `claude 2.1.238` 未登录，真实任务在写 workspace 前 exit 1；作为 provider-unavailable
  用户故事证据，不作为质量失败或成功。
- stream-json 依次提供 system/init、assistant/tool、result；init 含 session/cwd/tools/model/version。
- `subtype:success` 可能与 `is_error:true` 同时出现，adapter 必须以 exit/is_error/terminal reason/
  validated output 联合判定。SIGTERM exit 143 且无 terminal event。
- `--tools` 才是曝光边界；`--allowedTools` 只是 approval allowlist；request 永远不能传
  bypassPermissions/provider flags。

### Architecture

- UI4A-owned worktree 胜出：平台固定 base/branch/lease/CAS，避免 Provider-owned workspace 双真相。
- shared `events` + `domain=capability` 胜出；沿用 Presentation/Draft 的独立 fold + rebuildable projection。
- raw/provider payload 内容寻址分块；Business fold 在 storage boundary 过滤 capability domain。
- Temporal 使用 segmented workflow + heartbeat long activity；internal callback route 复用声明 action。

结论冻结于 D30；所有 disposable fixtures 位于 `/tmp`，没有进入产品源码。
