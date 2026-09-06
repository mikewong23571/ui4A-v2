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

## 主仓库集成与第一轮统一检查（2026-09-06）

- 保留 T56 P4.1/P4.2：合并提交 04a90058、416815dc；主仓库从 97b5dcb0 fast-forward 到 416815dc。
  其后 T56 原执行者提交 e0ce5a0a（collection-read-canvas 测试适配），T57 不覆盖该提交。
- 初轮 `pnpm check` 揭示 coverage 参数化测试的 TypeScript 形状和 Siren project 超限9行；
  按职责抽 `project-delegation.ts`、共享 collectionIdentity，保留功能与严格门禁。
- 一轮完整测试曾使用 `ui4a_t57_merge_test`：三个迁移/恢复套件按既有保护拒绝非精确 `ui4a_test` 名称。
  保持保护不变，改用测试专用 `ui4a_test` 运行最终全仓；开发/生产数据库未触碰。
- 旧 fixture 同步新 HOME v3 根/排序/catalog、行/表格、pathname。保留授权、Recipe promotion、
  空与裁剪同形、canonical collection exact links 等原断言，增加当前委托 running-only＋回链断言。
- 实际语义修复：显式 review-queue 保留卡片；delegations-current 不使 canonical delegations 多出自身collection链；
  委托成员补 canonical rel/identity，确保可由 generic 行实际读取。
- 第一轮通过命令：
  `TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test NODE_OPTIONS=--no-experimental-webstorage pnpm check`
  **exit 0；588 files passed / 8 skipped；4347 tests passed / 15 skipped**（86.52s）。
  typecheck/lint/strict通过；lint有36项既有warning，无error。opt-in真实模型另跑，不把skip算通过。
- `pnpm --filter @ui4a/web build` **exit 0**，实际 Next production build 成功。
- 最终复审新增：空委托文案“没有正在推进的工作”扩大了覆盖口径。改为“当前可见列表没有进行中的事项。”；
  empty-state **Red→Green 6 tests**，浏览器断言同步真实文案，避免不匹配子串导致假绿。

以上统一绿灯对应当时主仓库代码树；后续 review 修复将追加受影响复测，不将此记录冒充最终关闭。

## Review 修复后的统一检查与浏览器首轮

- 第二轮 `pnpm check` **exit0：590files passed/8skipped，4369tests passed/15skipped，79.78s**。
  包含真实绑定/折叠责任保全、slice缓存回归；随后新增关系链接导航修复另重验。
- 新模块定向V8覆盖：21files/141tests通过；9个指定模块（提交/重试ID、row、Sidecar载入、
  缓存、两层责任覆盖、thread-input、current/history投影）Statements94.83%、Branches88.05%、
  Functions95.65%、Lines97.32%。报告 `/tmp/t57-coverage`，不是全仓覆盖率。
- 第一轮完整E2E发现以下集成问题，主动中止重复等待：70passed、9failed、1interrupted、29skipped、20未运行，exit130。
  T57四条新增主故事均通过，不能据此称完整E2E已过。
  - 新建隔离库尚未建表，旧baseline自含harness直接TRUNCATE events失败；共享kit随后完成迁移/自举。
  - 旧CLI审批负例把client-owned commandId塞进params，按新合同改成--command-id后仍要求APPROVAL_FORBIDDEN/exit4。
  - 四视口application-directory旧用例未展开首页应用区；现在验证默认收起，再合法展开、比较高度/九项/完整目录。
  - smoke的header选择器因语义header变两个而严格失败，改指真实banner。
  - T30发现新slice回链经旧DetailWord跳/entity整页：links模式改Next Link，业务落canvas并保留上下文；Meta/Draft仍治理入口，外链原样。
  - T56两个输入故事仍把portal表单当动作行后代，改为精确“下一步”/“提交复核”Dialog宿主，保留原业务断言。
  - dual-executor一例500未稳定复现；追加回执诊断，在本任务新建的内存Temporal localhost:7237重跑**1passed/10.7s**。
    不能据此断言产品根因已证明；最终完整套件统一使用7237隔离执行历史。
- 第一轮浏览器停在旧portal定位等待时由编排器SIGINT中止，退出后3100/3110均已释放，未中断无关服务。
- 本任务拥有的Temporal7237为临时内存测试实例；不改7233开发环境，不清理其他人的7235。
