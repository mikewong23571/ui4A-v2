# T57 执行证据

## 用户授权与基线

2026-09-06 用户明确授权在独立 worktree 与 T56 并行推进；中间少重度/E2E，合并主仓库后统一验证。
工作树 `/Users/mike/projs/playground/ui4A-t57`，分支 `codex/t57-home-presentation`，基线 bf58603d（T56 P3）。
依赖离线冻结安装成功（pnpm install --offline --frozen-lockfile），未新增依赖。主仓库在途文件未带入/修改。

## P0 探针与定案

- S1：member-posture 4 Red → 4 Green；无论有无actions均可使用summary/table，绑定逐成员cognitive/members。
  row行为3 Red → 3 Green，独立review又增加6个负例并修到通过；D79明确责任/分组语义。
- S2：原创建源仅语法校验、重试会拒绝；JSON schema ownership注解已有通路。选 canonical goal＋commandId，
  原文与thread-created同事件原子来源thread-input；无新事件/状态。新创建4 Red→9 Green。
  真实隔离DB插入失败、并发重试、重放和owner过滤8 files/78 passed；CLI2 files/15 passed。
- S3：原首页视图与route focus脱节；共享HOME_WORKSPACE_DECLARATION同时提供my-work与实际首页selection。
  readonly threads-current/history、delegations-current保持规范HTTP来源；不把无delegation当无工作。
  父agent4文件34测试通过（含clientView、composition、compiler），随后新切片3文件22用例中的过期预期已修。

## 定向验证（重度/浏览器/模型留合并后）

所有Vitest使用独立 ui4a_t57_*_test 数据库，NODE_OPTIONS=--no-experimental-webstorage。

- actions子任务：6 files/41 passed；direct host rerender追加3 files/33 passed；Esc修复3 files/22 passed。
- coverage子任务：7 files/45 passed；显式groupRole修正后3 files/14 passed；直接Sidecar GET409→单次重规划。
- D54实际发现与正负例：7/7 passed；扩展扫描初次覆盖88个、集成后95个tracked runtime，strict通过。
- 父agent聚合：30files，200 passed/5 failed；失败来自旧责任fixture缺cognitive及结果回执降级，补正后
  approval-decision/member-row 18/18 passed；最终相关6files/38 passed。
- 独立review闭环：row/view2files11 passed；状态/上下文/真实opener追加4files44 passed。
- Web typecheck通过（新WT先next typegen）；CLI定向typecheck通过。格式/ESLint按修改域执行。

以上记录为实际分次结果，不把有重叠的测试简单相加；完整最终结论以合并后的新证据为准。

## 尚未完成的统一门禁

- 主仓库T56后续提交集成、冲突处理及最终diff复审。
- pnpm check、full E2E/invariants、production build。
- T57首页浏览器四视口/键盘/创建/责任/会话连续性及真实LLM working-context/t16-real-llm。
- 真人主观注意力指标未测，不由agent代填；部署不在范围，未发布。
