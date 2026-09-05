# T57 Plan

**仅规划，全部实施任务未开始。** P0 只读复核可与 T56 并行；代码实施须等待 T56 完成并通过 review，
记录交接 SHA 后继续。按 workflow 做 Red→Green→Gate、阶段 checkpoint 与 git notes。
任务/子任务状态须同步，不能以“父项完成/子项未做”或 registry 陈旧状态证明通过。

## P0 交接、探针与决定

- [ ] Task: P0.1 复核 T56 与架构基线
  - [ ] 读取本目录与正典，核查 T56 实际 plan/commit/review/dirty，登记共用模块交接 SHA。
  - [ ] 执行 strict/目录余量与扫描集检查，复核 A1–A6；其他任务脏文件不修改、不提交。
- [ ] Task: P0.2 执行 S1 组件姿态与责任保全探针
  - [ ] 同对象多 intent、混合集合、unknown/新应用，验证最小词汇/语义扩展与动作可达。
  - [ ] 验证 generic/Recipe/Sidecar 的责任保全和授权/依赖失效，记录方案、必要字段与测试路径。
- [ ] Task: P0.3 执行 S2 来源真实的直接创建探针
  - [ ] 对比既有 client-owned 装配与最小 canonical ingress 扩展，跑来源/重试/id冲突/拒绝/replay。
  - [ ] 证明无 LLM human 创建和 CLI/agent 同门，输出 schema、字段所有者及事务/顺序合同。
- [ ] Task: P0.4 执行 S3 首页来源与助手同源探针
  - [ ] 跑责任/open无委托/历史/空/部分失败/unknown fixtures，核对 HTTP、UI、clientView 和披露。
  - [ ] 记录排序/覆盖/分页/请求数量/输入存续，避免给首页创建第二聚合系统或 chat store。
- [ ] Task: P0.5 决策与详细设计 review
  - [ ] 追加有实证的 DECISIONS，精确替代 D50/D78.2 的组件选择假设，保留 D78 其余边界。
  - [ ] 将 S1–S3 出口回写 spec/design/acceptance/plan，复审愿景、接口、大小、同门与责任保全。
- [ ] Task: P0 Phase Verification & Checkpoint
  - [ ] 探针有证据、T56 正式交接成立、未决接口已定案，记录 checkpoint；否则不得开始 P1。

## P1 通用呈现语义与机械门禁

- [ ] Task: P1.1 Red 语义选择与扫描边界
  - [ ] 钉 US03/10：有动作非责任、无动作可比较、混合成员、unknown、跨域改名的失败测试。
  - [ ] 钉 D54 实际文件发现与合法/非法分支的正负例，明确哪些是核心协议机制。
- [ ] Task: P1.2 Green 词汇、姿态和动作披露
  - [ ] 按 P0 最小方案扩展声明/选择/词汇；低频动作可达，责任卡不退化为隐藏按钮。
  - [ ] 同步 catalog/compiler/validator/依赖版本，个人 Sidecar 与共享 Recipe 命中同样正确。
  - [ ] 扩展精确 D54 扫描/测试；仅拆本次贴限模块，不新增依赖或例外。
- [ ] Task: P1.3 Red→Green 责任保全与失效
  - [ ] 测 Surface 省略/折叠责任、成员/值/schema/授权变化和分页到达；修到各路径行为一致。
- [ ] Task: P1 Phase Verification & Checkpoint
  - [ ] 跑 G1/G2 对应门禁，亲看同一 fixture 的列表/决定卡/表格及其合同，记录 checkpoint。

## P2 首页工作简报与来源覆盖

- [ ] Task: P2.1 Red 首页处境与空/错状态
  - [ ] 钉 US01/02/11：首页有 open 线而无 delegation、只有历史、全空、未知、局部失败、无归属责任。
- [ ] Task: P2.2 Green 同源首页呈现
  - [ ] 扩展 my-work 声明/必要纯读源切片，当前/历史分层；排序有来源，数量/覆盖诚实。
  - [ ] 应用发现退为轻入口，保留完整目录与九项上限；不把业务区块写进首页 React。
  - [ ] 压缩重复状态、边框、机器标识/图例与空盒子，保留 raw/why 与失败出口。
- [ ] Task: P2 Phase Verification & Checkpoint
  - [ ] 跑 G2/G3 对应故事并审阅首页各状态截图；证明同源而非写死 fixture，记录 checkpoint。

## P3 输入宿主与首页协作

- [ ] Task: P3.1 Red→Green 创建合同与来源
  - [ ] 按 S2 先写 caller/client/来源、幂等、拒绝、身份、CLI 与 replay 失败测试，再实现最小装配。
  - [ ] 用户只填目标可直接建线，无模型也可用；真实来源可回读，不丢 required 字段或伪造来源。
- [ ] Task: P3.2 Red→Green 动作菜单与表单宿主
  - [ ] 钉菜单只选命令、Dialog/非模态场景、键盘/焦点、取消重开、草稿、schema过期与回执。
  - [ ] 复用 RJSF/ActionRunner/ActionSubmit，必要薄 primitives；风险文案不虚构 D78.4 保证。
- [ ] Task: P3.3 Red→Green 助手入口与跨页
  - [ ] 首页紧凑入口接既有 session，区别讨论/直接创建；页面加载无自动请求/业务写入。
  - [ ] 验证首页→T56本线→返回的 observation/clientView、草稿/SSE/停止与历史引用回归。
- [ ] Task: P3 Phase Verification & Checkpoint
  - [ ] 亲走 US04–09，复跑相关合同/组件/E2E，记录 checkpoint；不重复实现 T56 的壳或缓存。

## P4 全景验证与愿景反例

- [ ] Task: P4.1 视觉、跨域与故障故事
  - [ ] 常驻 home-presentation.spec.ts 覆盖 US01–12 的 UI 部分；指定尺寸/缩放、触屏/键盘均留证据。
  - [ ] 检查新应用/改名不改 UI、责任不被优化隐藏、模型失败可人工操作、授权裁剪不泄露。
- [ ] Task: P4.2 真实模型与生成式呈现
  - [ ] 执行 G4 的首页问答与 Recipe/Sidecar 变体验证，人工读回答并对照事实/副作用；skip不算通过。
- [ ] Task: P4.3 全量收口与成本对照
  - [ ] 执行 G5、精确格式/适用覆盖率；对照点击/机器字段/跨页/重解释成本，真人指标未测则明示。
  - [ ] 实际启动可运行系统，建立 evidence 的 FR/US/G 完整映射；部署单独标未发布。
- [ ] Task: P4 Phase Verification & Checkpoint
  - [ ] 核对所有必需证据适用当前代码树，仅标 ready-for-review；记录 checkpoint。

## P5 实现后 Review、Fixes 与复审

- [ ] Task: P5.1 Review 实际最终 diff
  - [ ] 创建 review.md，记录 reviewer 独立性、base/HEAD、FR/US/G、截图与架构 A1–A6 复核。
  - [ ] 检查没有新真相/规则助手/每应用分支/业务内视觉DSL/重复session，也未扩大已知执行差异。
- [ ] Task: P5.2 Review Fixes
  - [ ] 将 finding 逐条追加子任务，补复现后修复，记录 commit/受影响故事；无发现不造修复提交。
  - [ ] 复跑受影响门禁与必要全量，更新像素/模型/来源证据，不用旧测试绿灯覆盖新代码。
- [ ] Task: P5.3 Re-review 与关闭
  - [ ] 复审所有 finding 与必需故事，无范围内缺口和阻断性问题；NOT RUN 必需项保持开放。
  - [ ] DONE 分列实现/测试/浏览器/模型/真人/部署；GR5 清理/晋升探针、同步正典解释和三处状态。
- [ ] Task: P5 Phase Verification & Checkpoint
  - [ ] 记录最终复审/运行/工作树证据，完成后按仓库归档约定处理；不自动 push 或部署。
