# T56 Plan

状态：**规划完成，未实施**。本轮不执行以下任务。
顺序：P0 探针与定案 → P1 事实/呈现 → P2 壳 → P3 动作与协作 → P4 验收 → P5 review/修复/复审。
每阶段遵循 `conductor/workflow.md` 的 Red→Green→Gate、checkpoint、commit 与 git notes。
任务失败不得绕过其依赖；范围内必做故事保持开放，不能以降低验收标准取得 DONE。

## P0 开工复核、隔离探针与设计定案

- [x] Task: P0.1 记录执行基线与约束 (c8e61a4)
  - [ ] 读取本 track 全部文档与仓库正典；记录 HEAD/dirty/现行 DECISIONS、相关模块与测试路径。
  - [ ] 重测 `pnpm governance` 与目录余量，核查 T54/T55 已有实现；检查测试隔离和 3100 使用情况。
  - [ ] 创建 evidence.md 与 spike-report.md；标明环境、已有事实、未验证项、原始观察不等于部署事实。
- [ ] Task: P0.2 执行 S1 工作线呈现探针
  - [ ] 按 acceptance fixtures 搭隔离本线，记录 exact Siren/授权/依赖；尝试单主体首选路线。
  - [ ] 必要时与 derived Composition 对比；验证角色/责任/产出来源、同门、更新、部分授权和未知状态。
  - [ ] 输出最终数据/rel/path/词汇/声明/模块方案及探针代码去向，不复制第二个 dashboard。
- [ ] Task: P0.3 执行 S2 历史与引用探针
  - [ ] 跑 A→B 同 session→刷新、未知 clientView、集合重排、改名、权限撤回与迟到响应。
  - [ ] 核查历史过滤/读取页边界，验证超过默认上限仍能精确重建该回合，不误判缺失。
  - [ ] 定案 live/history 精确 turn join、时点显示、集合级诚实降级和缓存失效；列必要字段变更。
- [ ] Task: P0.4 执行 S3 布局与会话存续探针
  - [ ] 测指定尺寸/缩放/DOM 几何，验证草稿、SSE、停止、focus/back 及 `/chat` 不丢状态。
  - [ ] 定案并排阈值、覆盖交互与稳定 chat 状态拥有者；不引入布局依赖。
- [ ] Task: P0.5 先记录决定并 review 详细设计
  - [ ] 在 DECISIONS 追加证据支持的决定，明确 supersede 恒三栏/本线 noGaze；不改历史 track。
  - [ ] 回写 design、spec、acceptance、plan 的确定 shape/模块/命令/范围；不存在的功能不得标已有。
  - [ ] 以 FR1–FR10/US01–US12 检查设计覆盖、授权/缓存/历史边界；记录定案 review 与修订。
- [ ] Task: P0 Phase Verification & Checkpoint
  - [ ] 核对 S1–S3 出口全部有实证，规划未决已收敛、代码无废墟；记录命令/结果与 checkpoint。

## P1 本线读投影与声明驱动呈现（US01–04/10/11）

- [ ] Task: P1.1 Red：工作线读语义与授权
  - [ ] 在最窄 pure 边界补角色/空/未知/终局/归档未验收与“归档仍有责任”的失败测试。
  - [ ] 补 owner/跨应用授权裁剪/派生计数与名称不泄露，以及只读 HTTP 与 UI 同源的合同负例。
- [ ] Task: P1.2 Green：沿 P0 定案实现投影与呈现适配
  - [ ] 复用四类显式关系；必要读字段可重建，生命周期与成员写语义不变；不推断新真相。
  - [ ] 将本线接入同一 Presentation/Recipe/Sidecar；语义声明与依赖版本接线，布局不写领域类型分支。
  - [ ] 沿功能边界拆分贴限模块；更新 DB 测试分类，不删验证证据。
- [ ] Task: P1.3 Red→Green：失效与失败恢复
  - [ ] 钉住成员/同 rel 值/动作/授权变化后的更新与重放一致性；过期请求不得覆盖新主体。
  - [ ] 跑第二应用、未知语义、大工作集与部分不可读；验证有界读、计数和分页口径。
- [ ] Task: P1 Phase Verification & Checkpoint
  - [ ] 执行 G1 与相关 G5 子门禁，实际查看本线 Surface/HTTP 输出并核对来源，附 checkpoint。

## P2 主工作面与响应式壳（US01/03/05/07）

- [ ] Task: P2.1 Red：页面目标与空间契约
  - [ ] 写本线深链/无 focus/对象直链、唯一业务标题、返回与保留参数的行为测试。
  - [ ] 写助手/材料开关几何、手机/缩放、焦点/键盘、草稿/SSE 存续与旧响应竞争测试。
- [ ] Task: P2.2 Green：壳重构
  - [ ] 去掉线程 noGaze/说明书/应用书架旁路，移除默认材料常驻栏；内容消费 P1 呈现。
  - [ ] 实现剩余宽度优先的助手并排/覆盖，尊重用户选择；复用稳定 session，保留 float/popout。
  - [ ] 对象身份成为主要标题，合并次要工具入口；保留 raw/why/恢复/显式 Meta 桥。
- [ ] Task: P2.3 Gate：浏览器交互与视觉
  - [ ] 跑 G2/G3 对应故事；逐尺寸截图检查正文、关键按钮、滚动、层级、焦点与触屏操作。
- [ ] Task: P2 Phase Verification & Checkpoint
  - [ ] 实际操作 US01/05/07，与几何和截图交叉核对；更新 evidence 与 checkpoint。

## P3 材料、责任与聊天依据闭环（US02/04/06–10/12）

- [ ] Task: P3.1 Red→Green：材料关联与 pin
  - [ ] 先钉材料/pin-only/两者都有、重复添加、detach 被拒、archived 无动作、权限变化负例。
  - [ ] 复用 ObjectSelectorPanel 与 action submit，membership 同源；pin 改为固定视图语义。
  - [ ] 成功才更新关联及相关缓存，失败不清材料或 pin；零多余业务事件。
- [ ] Task: P3.2 Red→Green：知情决定与回执
  - [ ] 钉完整决定信息、未知前值、过期/重复提交、human/agent 权限、决定后回读和归档异常责任。
  - [ ] 复用现有确认/决定词汇与稳定回执宿主，补到达/绑定缺口；Meta 仍进入可信治理宿主。
- [ ] Task: P3.3 Red→Green：历史与当前范围
  - [ ] 钉 principal/session/turn 精确 join、缺失上下文、刷新、同 session 跨线、旧 SSE 与跨 principal 负例。
  - [ ] 钉超过默认历史页边界的重建，读路径使用既有过滤/分页；保留既有消息挂线与日志语义。
  - [ ] 将发送时上下文与历史时点沿既有投影接到 UI；当前输入范围取同源 observation。
- [ ] Task: P3.4 Red→Green：可辨引用
  - [ ] 钉同对象多字段、集合重排、缺历史 identity、改名、权限撤回/读取失败及导航参数保留。
  - [ ] 实现 P0 确定的身份/依据标签和时点边界，保留原 FactRef；不从当前索引猜历史实体。
- [ ] Task: P3 Phase Verification & Checkpoint
  - [ ] 运行 G1/G2/G3 受影响范围，亲走添加→阅读→决定→回执→历史→依据，记录 checkpoint。

## P4 全景验收与证据（US01–US12）

- [ ] Task: P4.1 常驻用户故事覆盖
  - [ ] 在 e2e/workstation/work-thread-workspace.spec.ts 等常驻套件补齐 US01–US11，更新本文档的最终命令。
  - [ ] 跑全部指定 viewport/缩放、授权、空/错/大工作集、两应用与未知语义 fixtures；审阅截图。
- [ ] Task: P4.2 真实协作与注意力走查
  - [ ] 运行 US12/G4 的真实 LLM X→Y→本线，逐条对照引用、披露与只读事件证据；skip 不算通过。
  - [ ] 执行 G6 的实际操作记录；真人五秒指标有测则记录方法，未测明确写未测。
- [ ] Task: P4.3 最终集成门禁
  - [ ] 执行 G5 的 check/full E2E/invariants/build，以及精确格式与适用覆盖率；记录退出码和运行数。
  - [ ] 核对每项 US/FR 的证据行，补齐未执行项；不使用历史测试数量或线上样例冒充结果。
- [ ] Task: P4 Phase Verification & Checkpoint
  - [ ] 实际启动并查看可运行系统，登记全部证据及未发布边界；此时仅 ready-for-review，不得归档。

## P5 实现后 Review、Review Fixes 与复审（必需）

- [ ] Task: P5.1 执行完整 review
  - [ ] 记录实现 base 与最终 review HEAD，按实际 diff 审查 FR/US/授权/缓存/历史/动作与治理，读取截图。
  - [ ] 创建 review.md：reviewer/范围/证据、Plan/Style/Coverage/Test checks、逐 finding 的优先级与文件行号。
  - [ ] 明确独立 review 或自审限制；代码/浏览器/真实 LLM 三类证据互不替代。
- [ ] Task: P5.2 Review Fixes
  - [ ] 为每个 finding 追加可追踪修复子任务，先补失败复现再修复；记录 commit 和受影响故事。
  - [ ] 复跑受影响测试与必要全量门禁，更新截图/真实 LLM 证据；无 finding 时记录实际审查结论，不造修复提交。
- [ ] Task: P5.3 Re-review
  - [ ] 对修复后的最终代码树重审所有 finding 与 FR/US；无范围内未满足验收，无阻断性 P0/P1/P2。
  - [ ] 确认 G1–G7 必需项通过；未执行真实模型/关键浏览器验证则保持 track 开放，不伪造 DONE。
- [ ] Task: P5.4 完成文档与归档准备
  - [ ] 创建 DONE.md，分列实现/测试/浏览器/模型/真人观察/部署状态；同步受影响正典解释与操作文档。
  - [ ] 按 GR5 晋升/删除探针，清理过时测试与注释但保留历史 track；核验相对链接和 metadata。
  - [ ] 仅在全部必需门禁通过后完成 plan/registry，按仓库约定归档；不自动 push/部署。
- [ ] Task: P5 Phase Verification & Checkpoint
  - [ ] 附最终 diff 范围、复审结论、验收命令/结果与 notes；核对工作树和本地系统可运行状态。
