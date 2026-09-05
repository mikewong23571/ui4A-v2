# T56 Acceptance

本文件是实施与 review 的统一验收合同。所有样例须在隔离测试库生成，不依赖线上样例仍存在。
本轮仅规划，本文任何测试或截图均未执行/生成；实施期结果另记 `evidence.md`。

## 1. 数据与运行约定

复用 `e2e/kits/test-isolation.ts`、`server-kit.ts`、现有 Work Thread、confirmation、
composition 与 working-context fixtures。每次运行使用唯一前缀，如 `t56-<runId>`；
建立关联时走规范 create/attach，fixture 如需 seed 必须限定在测试 harness，禁止写开发/生产库。

| Fixture     | 必需数据                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| A 工作线    | open；一个明确目标；跨两个 application 的 context；一条 active；当前及已决定的 approval；一个显式 event |
| B 工作线    | 另一个目标与对象，同 principal、不同 thread；与 A 共用一个 chat session 测会话独立性                    |
| C 空线      | open，无材料/active/approval/event，goalSource 无可读标题                                               |
| D 收尾线    | completed/archived 两种；有普通材料但无产出/验收声明；另有带有效产出/验收来源的正例                     |
| E 异常线    | paused、dangling、部分不可读、全线不可读、目标网络失败、归档但关联仍待判断责任                          |
| F 授权      | owner、其他 principal、少一个应用授予；同 sessionId 的跨 principal 碰撞；授权读取后收回                 |
| G 引用      | exact entity、同对象不同字段、集合 /entities/1/... 后重排、历史缺 clientView、对象改名与不可见          |
| H 扩展性    | 未在 UI 中硬编码的新 application/flow，声明身份/责任/产出语义；另有未知认知语义合同                     |
| I 大小/竞争 | 30 个长标题材料（按现有分页/有界读）；快速 A→B→返回；慢请求/旧 SSE 晚到、双次提交                       |

A 的目标例如“完成一项跨应用评审并记录决定”；对象可使用既有发布/开发 fixture，
不要求线上 ideas 应用，也不允许 generic 实现引用这些名字。
业务动作正例由合适的人类测试通道执行；agent approve 负例必须真实被拒并留痕，
不得通过身份伪装或修改 Cedar 完成所谓闭环。

## 2. 用户故事（全部必需）

| 故事                | Given / When / Then                                                                                                                                                                                                                         | 证据与归属                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| US01 恢复一件事     | Given A；When 深链进入本线或 thread 无 focus；Then 看见目标、生命周期、当前可见责任与关联工作，主区域不是说明书/应用书架；当前责任与普通材料明确区分                                                                                        | P1/P2；纯投影+HTTP+浏览器                 |
| US02 知情决定       | Given A 的当前确认；When 从概览查看并提交合法决定；Then 同一主面可读目标、动作、可得前后变化与依据；未知明确；一次提交走原闸门，回执保留、状态回读，过时动作消失                                                                            | P1/P3；确认集成+浏览器+agent approve 拒绝 |
| US03 理解进行与暂停 | Given A/E；When active 目标由执行中变终局/线暂停；Then 显示对应合同状态并更新概览，未知状态不被硬编码误判；不要求手动刷新才看见变化，不自动改变用户正在看的对象                                                                             | P1/P2；依赖/失效测试+浏览器               |
| US04 归档回顾       | Given D/E；When 打开 completed/archived 线；Then 普通材料不冒充成果，无验收来源不显示通过；有声明来源可到达；归档仍有待处理关联项时不隐藏；原合同 archived 无动作则添加/移除不可提交                                                        | P1/P3；投影+浏览器                        |
| US05 阅读空间       | Given A 和长正文；When 1440/1280/1080/768/390px 展开/关闭助手与材料；Then 达到 design 宽度条件才并排，无永久第三栏，无 body 横滚，关键标题/动作可读，200% 缩放与键盘可用                                                                    | P2/P4；DOM 几何+逐尺寸截图                |
| US06 材料与固定视图 | Given A/C，另有仅 pin 的对象；When 从选择器/对象入口添加、重复添加、移除或取消 pin；Then membership 同步且与 HTTP 一致；pin-only 明确不属材料；失败不假成功、不清另一种状态；触屏也能发现操作                                               | P3；组件+事件/HTTP+浏览器                 |
| US07 指代与返回     | Given A；When 看材料 X→Y→引用→返回本线→浏览器后退；Then URL、常显、下一次 clientView 指向同一对象，线与 scope 正确保留；从外部直接进 X 不隐式建线                                                                                           | P2/P3；presence/navigation+浏览器         |
| US08 当时与当前     | Given 同一 session 的 A/B 历史与未知上下文旧回合；When 切线、提问、刷新、选择历史会话；Then 历史保留各自 turn/时点/当时可证上下文，未知不补造；当前输入范围正确；不自动换会话或把 B 标签贴到 A 回答                                         | P3；history route+live/history UI+浏览器  |
| US09 可辨引用       | Given G；When 阅读三条不同依据并点击，再重排集合/改名/收回权限；Then 能辨依据类型与可证目标，保留原 rel/pointer；今日第 N 项不能伪装当时成员；缺证据明确集合级来源；不可见时不继续展示失效标题缓存                                          | P3；引用单测+HTTP+浏览器                  |
| US10 安全与诚实恢复 | Given E/F；When 网络失败、授权变更、跨 principal、缺失字段/LLM 故障；Then 不泄露隐藏名称/计数/链接，不把不可读标成空；有恢复出口；人工读/操作不依赖模型，无 rule fallback/额外业务写入                                                      | P1/P3/P4；授权/故障负例+浏览器            |
| US11 扩展与性能     | Given H/I；When 同一组件呈现另一 application 与大工作集；Then 无需改 generic UI 即可使用声明内容/动作；未知语义诚实可读；读请求有界、分页真实、职责不因折叠或截断消失，切 A→B 的旧响应不覆盖 B                                              | P1/P4；fixture 变体+请求/依赖测试+截图    |
| US12 真正的协作     | Given A/B 与配置的真实 LLM；When 同 session 在 X/Y 各问“这个现在怎么样，给出依据，只读取”，并问本线“哪些在等我”；Then 基于当轮事实回答，引用可验证，UI 与实际 clientView 一致；折叠/切模式不丢草稿/SSE/停止；模型不可用时诚实失败且无业务写 | P3/P4；真实 LLM+流式注入+HTTP 对照        |

US02 的“同一工作面”对业务确认成立；Meta 定义批准依旧显式跨入可信治理宿主，
保持 thread/scope、diff/checks 与回程。这是必须验证的边界，不为了免跳页破坏 BIOS 审查。

US12 不用字符串关键词判定回答质量。机械核对来源/对象/副作用，人工读回答是否谈对对象；
可使用既有 Story Eval，保留真实 provider 配置来源与脱敏运行证据，不能以 mock PASS 替代。
本文“只读/无业务写”指无领域对象、生命周期、审批与额外材料 mutation；既有 chat/presence
记录及对本次 user message 的显式 owned-thread attach 按精确 channel/messageId 单独核对。
不得笼统放行全部 thread events，也不能为让断言为零而删除现有日志或消息挂接行为。

### 需求追踪矩阵

| 要求             | 主验收故事          | 实施阶段 |
| ---------------- | ------------------- | -------- |
| FR1 本线主内容   | US01/07             | P1/P2    |
| FR2 信息层级     | US01/02/03/05       | P1/P2/P3 |
| FR3 处境与事实   | US03/04/10          | P1/P3    |
| FR4 阅读空间     | US05/12             | P2       |
| FR5 材料/pin     | US06/04             | P3       |
| FR6 知情决定     | US02/04/10          | P1/P3    |
| FR7 当时/当前    | US07/08/12          | P3       |
| FR8 引用依据     | US09/10/12          | P3       |
| FR9 诚实恢复     | US05/10             | P2/P3    |
| FR10 同门/新鲜度 | US03/06/07/10/11/12 | P1/P3/P4 |

F01–F06 的原观察分别由 US05、US01、US04、US05/07、US06、US08/09 覆盖。

## 3. 必需门禁与可执行命令

命令从仓库根执行。新增测试随实现放入常驻领域目录，不保留 T56 专用 Playwright 配置。
下列是已核实入口；P0 若迁移/新增测试，必须同步本表到最终可执行路径，不能留下占位命令。

### G1 语义、授权与重放

```bash
pnpm vitest run packages/shared/src/work-thread.test.ts packages/engine/src/projection/work-thread.test.ts packages/engine/src/projection/fold/apply-thread.test.ts
pnpm vitest run apps/web/src/engine/service-tests/service.thread.test.ts apps/web/src/engine/service-tests/service.confirmation.test.ts apps/web/src/engine/service-tests/service.meta-confirmation.test.ts
pnpm vitest run apps/web/src/engine/presentation/runtime-composition.test.ts apps/web/src/engine/presentation/authorized-entity.test.ts apps/web/src/engine/presentation/sidecar-authorization.test.ts
```

这些是回归基座，不代表已覆盖全部新故事。必须新增 Red 断言覆盖角色投影、归档未验收、
权限变化、Sidecar 命中后的 membership/value/action 变化和 replay 派生一致性。
若读投影无新写入，复用已有重放 fixture；若确有事件 shape 变化，必须补对应 parser/DB replay 门禁。

### G2 壳、动作、历史与引用

```bash
pnpm vitest run apps/web/src/components/canvas apps/web/src/components/actions/thread-material-add.test.tsx
pnpm vitest run apps/web/src/components/chat apps/web/src/app/api/chat/history/route.test.ts apps/web/src/chat/conversation.test.ts
```

断言必须检验用户行为与事实，不仅检查 class 字符串。US06/US08/US09 的失败、unknown、
旧请求覆盖和授权缓存负例必须显式存在。必要的读模块拆解后更新路径，不能漏跑。

### G3 浏览器用户故事与视觉

在现有 `e2e/workstation/` 下新增常驻 `work-thread-workspace.spec.ts`，并复用/扩展：

```bash
CI=true pnpm e2e e2e/workstation e2e/t26-work-thread.spec.ts e2e/interaction/chat-citations.spec.ts e2e/chat.spec.ts
```

测试环境的 `TEST_DATABASE_URL` 指向隔离库，缺省 `localhost:5433/ui4a_test`；
Temporal 使用已有隔离配置（Playwright 缺省 `localhost:7235`），不可复用开发 Temporal。
CI 会启动独立 web server；先检查 3100 占用，不杀无关服务或让测试打到线上/开发库。
需要真实日常栈走查时使用 `pnpm dev:all`，与隔离 E2E 分开运行。

必留截图：本线概览、决定前/后、归档有/无验收、材料及 pin 区分、历史 A/B 与当前范围、
集合引用未知边界、错误恢复，以及 §1 全尺寸助手开/关。每张记录 viewport/route/fixture/SHA。
比较 DOM 与像素，排除截图缩放伪影；review 必须实际看截图，不能只信测试输出。

### G4 真实 LLM

```bash
RUN_LLM_EVAL=1 \
DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
TEST_DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_test \
pnpm eval:llm --project=working-context
```

执行前通过已有安全环境装配提供 `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`，不得在命令或报告中写值。
使用其他隔离测试库时必须同时替换两个数据库变量并通过现有隔离校验。
把 US12 的 X→Y→本线三轮与引用验证加入已有 `working-context.spec.ts`。
若因规模必须拆文件，需同步现有 `playwright.eval.config.ts` 的固定 project 注册和此命令；
只放进 eval 目录不会自动运行，不新增 track 专用配置。
执行前按现有 eval kit 验证隔离数据库、Temporal、模型 profile 与 opt-in 条件；
零用例、skip、缺凭证、网络不可达记 NOT RUN/失败，不可记 PASS；真实门禁未跑不宣称完整完成。

### G5 集成收口

```bash
pnpm check
CI=true pnpm e2e
CI=true pnpm e2e invariants
pnpm --filter @ui4a/web build
```

按最终改动跑精确 Prettier 检查与有意义的新代码覆盖率，目标 >80%；纯文档/机械样式不造镜像单测。
保持 `pnpm governance:strict` 空例外，通过后不无理由反复重跑；review 修复后复跑受影响测试，
若触及共用授权/呈现/会话边界则补相应全量门禁，确保证据适用于最终代码树。

### G6 注意力成本走查

编排 agent 用 US01/02/04/05/08 顺序实际操作，记录：找到目标/责任所需点击、决定前跨页次数、
是否重新解释上下文、是否误读历史为实时、是否仍需缩小字号。US02 普通知情决定不跨业务页面；
关键来源/原始合同最多两步可达；材料/助手一处入口可开关，不依赖 hover。
真人“五秒说清目标/状态/是否需要我”测试使用同一 fixture 前后对照，记录人数、计时方法与答案；
未进行则写“真人注意力指标未测”，不可宣称用户厌烦感已经下降，也不伪装成自动化硬门禁。

### G7 实现后 review → fixes → re-review

不得只审 plan 的打勾结果。按本 track base→实现 HEAD 的实际 diff，逐条核对 FR/US，
检查纯内核/适配边界、声明来源、授权、新鲜度、会话独立性、引用时点、视觉和测试有效性。
reviewer 应独立于本次实现过程；无独立 agent 时至少另起明确的 review pass，声明自审限制。
review 发现落入 plan 的 Review Fixes，修复后复测并复审。
任何未满足必需 FR/US、P0/P1、或影响正确性/授权/主要体验的 P2 都阻止完成。
仅真正超出本 track 的问题可单独记录范围和证据；不得把必做故事改名为后续建议来关闭。

## 4. 证据记录格式与完成口径

实施期创建 `evidence.md`，每条至少包含：

| 字段         | 内容                                                               |
| ------------ | ------------------------------------------------------------------ |
| Story / Gate | US 编号、FR 编号、G 编号                                           |
| Version      | 实施 base、被测 HEAD、dirty 状态；若代码有变，说明证据仍适用的范围 |
| Environment  | 本地/隔离 E2E/真实模型；不填凭证值，不把本地写成线上               |
| Reproduction | fixture、具体命令或点击顺序、预期结果                              |
| Result       | PASS / FAIL / NOT RUN / 不适用及依据；退出码和实际运行用例数       |
| Evidence     | 测试结果、HTTP/事件/receipt 对照、截图路径、读请求数量和边界       |
| Review       | finding ID、修复 commit、复测/复审结果                             |

截图与精简报告留在 track 的 evidence 子目录，去除用户隐私和凭证；不提交完整 Playwright 报告、
数据库、`.next*` 或临时 probe 脚本。临时探针转为常驻门禁或删除，符合 GR5。
最终 DONE 分列“实现/自动化/浏览器/真实 LLM/真人观察/部署”。本 track 不含发布，
线上复验写“未部署，未验证”，不扩大本轮授权；本地必需门禁全部通过才可标完成。
