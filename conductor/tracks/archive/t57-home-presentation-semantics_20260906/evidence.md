# T57 执行证据

状态：已完成。以下按实际执行阶段保留失败与修复履历；当前结论以文末“最终结论与可复验入口”为准。

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

## 19ae4e49 后实际浏览器/模型复审修复

- 完整浏览器第二轮：**99passed、1failed、29skipped（129用例，4.3m）**。唯一失败验证出工作线实体
  没有collection回链时仍无法失效当前slice；继续补观察成员关系与同canonical集合兄弟slice的闭包失效。
  单独无回链成员Red、先缓存空历史再缓存当前的Red均复现；最终cache4files/35tests通过。
  此为通用读依赖失效，无业务实体名字条件；历史为空也不能漏刷新。
- 亲看1440与390首页、责任混合、创建Dialog截图，发现有resume的inbox确认跳过完整知情面。
  改为confirmation始终fresh read；读就绪显示对象/动作/参数/依据和未提供的前后信息，重复raw摘要退到
  按需合同详情；读取失败可重试且不开放依据未知的执行控件，terminal事实屏蔽陈旧props动作，Meta桥保持。
  词汇/动作聚合复跑**26files/132tests通过**，其中MemberCard/approval-decision19项。
- 实际模型第一轮：unlocated discovery、跨应用工作线、T56同session三轮协作、S1/S3理解均已通过；
  首页故事在模型调用前因测试请求limit=1000违反API的1..100范围失败，改为每页100的完整cursor遍历，
  保留所有thread事件前后相等要求，不放宽为只看首屏事件。
- G4绑定树7758 UTF-8字节；同一配置模型曾生成两次合法patch且真实HTTP200，但多次60s流超时。
  已先按D79登记，将Revision默认对齐D43的300s单次上限；不加自动重试，不改provider或短deadline覆盖。
  70s合法返回/300s中止/显式10ms中止的行为Red→Green，parent复跑deadline+parse**5tests通过**。
  延长超时不等于改善实际延迟；本次源修复及首页/模型故事仍需最终复验。

## 最终结论与可复验入口（2026-09-06）

最终生产代码：**3ae4a24c**。此前T57 feature edb35f03；T56交接/集成04a90058、416815dc；
集成修复19ae4e49、84d3a4c3、0d754c88。后续只补四视口截图、触屏用例和关闭文档。
所有记录按实际代码/时间分列，不把重叠用例相加，也不把专项目的skip当通过。

| Gate | 实际结果 | 证据与范围 |
| --- | --- | --- |
| G1/G2/G5 全仓 | `pnpm check` exit0，593files/4393tests passed；8files/15tests opt-in skipped | 3ae4a24c；typecheck、lint、strict、纯/DB/invariant单测均过。日志 /tmp/t57-release-check.log |
| G3/G5 完整浏览器 | 100passed/29专项skip，exit0，4.7m | 84d3a4c3；全仓包含invariants、T56用户故事、CLI、审批与replay。无变化的invariants不再另跑重复命令 |
| G3 最新受影响首页 | 4passed，exit0，24.1s | 3ae4a24c；真实touch上下文＋tap、键盘、四尺寸、丢已接受响应后同键重试、责任卡完整事实、收起责任409不改视图。全量通过后只复测受后续改动影响的故事 |
| G4 首页真实LLM | 1passed，约3.0m，exit0 | 当前代码、同实际浏览器workspace属主；逐条HTTP验证sources、目标名称、paused区别、原投影/全部thread事件不变、外主与历史不泄露；已人工阅读原文 |
| G4 generic/Recipe/Sidecar | 1passed，205.463s，exit0 | 三条真实模型提议原样走HTTP：两次200、隐藏责任一次409，原版本保留；事实与core事件不变；跨principal拒绝 |
| G4 S24语义变体 | 1passed，72.217s，exit0 | 五种真实提问；用真实applyRenderPatch验证合法性、正文可见/阅读祖先spacious、actions已折叠；不以固定叶子ID误拒合法父区 |
| G4 前序协作回归 | 4个独立standing case已过 | 未定位发现、跨应用工作线、T56三轮共同session、S1/S3应用及Markdown理解；原文/只读结果在此前 /tmp/t57-final-eval.json。新引用/groupRole说明另由最终首页案例验证，不将前序运行冒称相同prompt字节 |
| 原生200%与实际像素 | 已走查并保存 | 独立Chrome for Testing148，原生toolbar200%；首页/表单可读，长输入换行、Tab循环、Escape焦点回触发、重开保留草稿；已还原100%。非CSS zoom/设备scale替代 |
| 缓存密度像素 | 已走查并保存 | 相同首页root compact/spacious切换并重载，截图分别为8px/32px留白；3个集成用例钉住版本化root映射 |
| 构建与格式 | production build exit0；129个改动代码文件Prettier通过 | /tmp/t57-release-build.log、/tmp/t57-format-final.log；构建前移除临时Next根与其自动tsconfig include，未留下配置漂移 |
| Coverage | 定向9模块97.32% lines、88.05% branches | 21files/141tests；属于19ae4集成阶段的报告 /tmp/t57-coverage，不冒称全仓或其后新增修复的最新覆盖率；后续修复另有Red/Green及全仓验证 |
| G6 最终复审 | 无范围内阻断项 | creation/governance/action_ui交叉review＋编排亲跑、读模型与看像素；finding闭环见review.md |

### FR / US 对照

| Story | 主要实际验收 |
| --- | --- |
| US01/02 | home四viewport、空/历史/current/foreignowner；partial授权runtime/route；空委托不否定open线 |
| US03/10 | member-posture/row/table/unknown、跨域改名D54；T56第二新应用＋30材料浏览器全过，完整目录仍≤9入口 |
| US04 | 新首页真实确认与完整decision-info；T56知情决定、过时动作退场、归档仍保留pending、回执、Meta桥；纯human-only不变量 |
| US05/06 | ActionGroup disclosure与Dialog draft/focus/guard/schema；真实touch与keyboard；不可信回执诚实显示“结果未确认” |
| US07 | 单输入goal，真实丢响应已接受＋重试一个event；原文回读；CLI/client params、owner冲突、DB失败与重放 |
| US08 | 共享Home声明及clientView；真实LLM具体目标/状态/有效引用/零业务effects，未把容器标注当待决 |
| US09 | 首页↔本线保持session/draft；T56X→Y→本线/后退/SSE/停止；关系链接留canvas与上下文；历史消息按当时处境 |
| US11 | 真实HTTP model patch拒绝隐藏责任；UI409卡片继续可达且版本不变；invalid required binding/新责任/授权/旧view/paging路径有纯及service/route回归；slice成员迁移刷新空兄弟 |
| US12 | 1440×900/1080×820/768×1024/390×844无body横滚；原生200%；四尺寸像素、Dialog/助手/责任图已看；strict无例外 |

完整FR映射沿acceptance §2，所有FR01–FR10均落在上表故事中。

### 可保留的精简证据

- [浏览器清单](./evidence/browser-manifest.json)：viewport、touch、原生zoom、截图SHA-256与完整浏览器skip名单。
- [模型原文与实际提议/回执](./evidence/model-evidence.json)：只保存隔离fixture相关事实、回答、sources、版本与结果；不保存凭证。
- [首页宽屏](./evidence/home-current-1440.png)、[1080](./evidence/home-current-1080.png)、[768](./evidence/home-current-768.png)、[390](./evidence/home-current-390.png)。
- [完整责任卡](./evidence/home-responsibility-and-summary-1440.png)、[不可信回执输入保留](./evidence/home-create-failure-390.png)、[窄屏助手](./evidence/home-assistant-draft-390.png)。
- [原生200%首页](./evidence/t57-native-zoom200-home.png)、[原生200%表单](./evidence/t57-native-zoom200-dialog.png)。
- [compact重载](./evidence/t57-density-compact-reloaded.png)、[spacious重载](./evidence/t57-density-spacious-reloaded.png)。

### 成本变化与不作出的承诺

- 发起必须手填的机器字段：原id/goalSource两个→零；新建入口到目标表单两步，提交依然可直接人工作用，不依赖LLM。
- 普通行默认管理动作从整组展开→一个“更多操作”；决定卡仍直接显示批准/驳回及完整可得依据。
- 当前/历史分层，空委托不再冒充没有工作；跨页保持同session与草稿，关系链接不把人推出工作台。
- 对象/动作的业务友好title若合同未提供，仍展示真实rel/action，不以UI或AI猜译；policy依据仍原文。
- 真人找目标耗时、厌烦感、两周目标达成率**未测**。真实模型首页回答约3分钟，延长硬上限不等于提速。
  T58应把模型等待、回答简洁度与真实业务名可读性列入实际使用观察；本次不宣称注意力收益已被真人证明。
- 生产部署**未执行**，线上UI4A未更新/复验；T58冻结和336h试用**未开始**。T56由原agent关闭，本track不代改其状态。
