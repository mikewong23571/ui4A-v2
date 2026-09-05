# T56 S3 探针报告:剩余宽度、草稿与流式生命周期(P0.4)

> 执行:P0.4 subagent(S3),2026-09-06。对应 design.md §1 几何/阅读下限、§3-S3;
> spec §4 FR4/FR7;acceptance §2 US05/US07/US12 存续部分;spike-report §3 骨架的回填。
> 本报告只写探针事实与定案建议;不改 spec/plan/DECISIONS/evidence(登记由编排 agent 决定)。

## 0. 环境与隔离栈(DoD-1)

- **HEAD(被测)**:`493dc67ddfa6dd8828daf8837c22ffd55ce50cc8`(仅 plan.md `[~]` 为编排改动;
  并行 S1/S2 的探针文件与 s1-presentation.md 同时在工作树,本任务未触碰)。
- **隔离库**:`docker exec ui4a-postgres psql -U ui4a -c 'CREATE DATABASE ui4a_s3_test'`
  (新建成功;dev 库 `ui4a` 与默认 `ui4a_test` 未使用)。
- **隔离 server**:
  `DATABASE_URL=postgres://ui4a:ui4a@localhost:5433/ui4a_s3_test TEST_DATABASE_URL=同值 PORT=3110 UI4A_DIST_DIR='.next-t56s3' pnpm --filter @ui4a/web dev`
  - `UI4A_DIST_DIR` 为必需:Next 16 dev 对同目录单实例锁(3100 是用户 dev server,PID 328,
    未触碰),e2e server-kit 同口径(`e2e/kits/server-kit.ts:112` 附近)。
  - 启动确认:`curl http://localhost:3110/` → HTTP 200;首次请求自动跑
    `prepareDatabaseForApplication`(schema+应用 bootstrap)。
  - 副作用记录:Next dev 启动时改写了 `apps/web/tsconfig.json`(include 加 `.next-t56s3`),
    server 停止后已 `git checkout -- apps/web/tsconfig.json` 还原;`.next-t56s3`(603MB,
    git-ignored)已删除。
- **fixture**:工作线 `t56s3-a2c71f`(随机后缀;`/api/exec` `threads/create` + `attach`
  context=`articles`,principal=local-user,本地信任域,浏览器零登录)。
- **Temporal/worker**:隔离栈未起(允许);聊天真实发送会走 `.env.local` 的真实 LLM
  key——为不耗用户配额,受控 SSE 全部走注入(见 §3 模拟口径),真实栈用于渲染/几何/历史/执行 API。
- **探针执行方式**:仓库内 Playwright(chromium,`@playwright/test@1.62.1`)+ node 脚本,
  量 DOM bounding boxes;已正常结束的只有本任务自起的进程(3110 已释放,3100/7233/7235 未动)。

## 1. 几何实测(DoD-2)

route A = `/canvas?thread=T&focus=thread:T`(本线概览,书桌栏+注视栏);
route B = `/canvas?thread=T&focus=articles`(对象注视,同一两栏几何)。
chat「展开」= FAB 点击后进线自动停靠(`floating-chat.tsx:86-91` dockedThread 逻辑)。
全部 CSS px 实测(`probes/scripts/s3-geometry.mjs` 输出;截图见 `probes/shots/`)。

### 1.1 主区(注视列)宽度表

| 视口(CSS px) | 书桌栏 关/开 chat | 注视列 关 chat | 注视列 开 chat(停靠) | chat 宽 | body 横滚 开 chat | 模式说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1440×900 | 384/384 | **568** | **568** | 384 | 无 | main 被 `max-w-5xl`(1024)封顶,停靠不改变 main |
| 1280×800 | 384/384 | 568 | **440** | 384 | 无 | 停靠把 main 压到 896,注视 440 |
| 1080×820 | 384/384 | 568 | **240** | 384 | 无 | **F01 实锤:三栏,中栏 240px 最窄**(`1080x820-thread-itself-chat.png`) |
| 768×1024 | 720(整宽,`<lg` 堆叠) | 720 | 336 | 384 | 无 | 堆叠单列仍被 chat 停靠挤到 336 |
| 390×844 | 342(整宽) | 342 | 152 | 384 | **是(docSW 584 > 390)** | 停靠溢出屏幕;注视 152px |
| 960×540(=1920×1080 @200% 缩放) | 912(整宽,`<lg`) | 912 | 528 | 384 | 无 | 200% 缩放布局视口 960 < `lg`(1024),书桌堆叠;停靠挤注视到 528 |

补充几何事实:

- **书桌栏 + main 封顶使 640px 阅读下限在当前壳内任何视口都不可达**:关 chat 时注视列恒为
  568(=1024−48−384−24 gap)。开 chat 后 1440 仍 568、1280→440、1080→240。
- **390px float 形态**:`w-96`(384)+`right-4`(16)> 390 → 面板 x=−10,左缘被裁出屏
  (`390x844-chat-float.png`);float 不挤主区(overlay),但违反「390px 覆盖助手不能超出屏幕」。
- **390px sidebar 形态**:chat x=200,右缘 584 → body 横向滚动(docScrollWidth 584)。
- **顶栏**:未测出 scrollWidth 溢出(header flex-wrap 兜住);品牌 span 实测 32px
  (flex shrink 压缩,应用名/书架条目在窄注视列下出现省略号截断,见 1080 截图「Agent …」)。
- **H1 清点**:本线概览(route A)**0 个 h1**(线身份在 h2);对象注视(route B)**2 个 h1**
  (`共同注视` 机制标题 + `文章`)。design §1「只呈现一个主要 H1(实体身份或本线目标)」
  两个方向都不满足。书桌栏身份卡为 h2(`T56 S3 布局与会话存续探针工作线…`)。
- 助手宽:`w-96`=384px,略超 design 建议 320–380 的上限 4px(非阻断,下文阈值以 384 实测)。

### 1.2 并排/覆盖切换阈值定案(对照 design 规则推导)

design 规则:主区 ≥640 CSS px 且 ≥两栏净宽 60%;助手 320–380。实测 60% 条件在 ≥640 时恒满足
(640/(640+384)=62.5%),**640px 是绑定约束**。P2 去掉永久材料栏后注视列 = min(vw−chat, 1024)−48,
解 `min(vw−chat,1024)−48 ≥ 640`:

- **chat=384px 时,并排条件为视口 ≥ 1072 CSS px**。实测核对:1080 → 注视 648(62.8%)✓;
  1024 → 592 ✗。即 **1080 恰好是当前 384px 助手并排的最小通过视口,1024(`lg:`)不行**。
- **chat=320px 时,并排条件为视口 ≥ 1008**;1024→656 ✓。
- **200% 缩放(1920 屏)= 960 CSS px < 1008:任何助手宽度都不得并排,必须覆盖/单面**。
- 建议 P2 实现为「剩余宽度」判断(main 容器减去助手后 ≥640 且 ≥60%)而非整屏 `lg:` 断点
  (design 已禁止仅整屏断点);以 `vw − 全局 padding(48) − 助手宽 ≥ 640` 为切换条件,
  助手 384→阈值 1072,收窄到 320→1008。当前 `railOn` 无条件三栏 + 进线强制 sidebar
  (`canvas-body.tsx:22`、`floating-chat.tsx:88-91`)与上述全部矛盾。

## 2. 草稿/会话存续矩阵(DoD-3)

真实 UI、隔离库、未发送草稿注入 composer(`textarea[placeholder="输入目标…"]`)。
sessionId 连续性 = 面板头「会话 <id8>」+ `localStorage['ui4a.chat.sessionId']`。
脚本:`probes/scripts/s3-persist.mjs`、`s3-popout-session.mjs`。

| 切换场景 | 未发送草稿 | 在途流式回合 | 停止按钮可达 | 会话选择(sessionId) | 判定 | 证据/机制 |
| --- | --- | --- | --- | --- | --- | --- |
| 客户端导航切 focus/目录(Next Link,根布局不重挂) | PASS | PASS(流继续,final 落地) | PASS | PASS(同实例) | PASS | FloatingChat 挂根 layout;`clientview-focus.mjs` CV 系列 |
| 浏览器后退(popstate) | PASS | PASS | PASS | PASS | PASS | persist 步骤 2 |
| 收起(X)→ FAB 再展开 | PASS | PASS(流在后台继续不中断) | 收起期间无 UI 可点(流未被 abort) | PASS | PASS(带告警:见下「重开不回停靠」) | 状态在 FloatingChat 的 useChatSession,ChatPanel 重挂不丢 |
| float↔sidebar 形态切换(流中) | PASS | PASS | PASS | PASS | PASS | 同上;ChatPanel 树重建,runtime 存活 |
| 窗口缩放 1440→1000→390→1440(流中) | PASS | PASS | **390 时在 DOM 但不可视**(stopInView=false,chat x=200,右缘 584) | PASS | PARTIAL | `sse.mjs` J 步;390 停止键被挤出视口 |
| **书桌材料条目点击**(`thread-desk.tsx:290` 裸 `<a href>`) | **FAIL**(整页刷新,面板塌回 FAB,草稿丢) | **FAIL**(页面卸载 abort fetch) | **FAIL** | PASS(localStorage sessionId) | **FAIL** | `clientview-focus.mjs` CV2a:`hardNavCollapsedPanel=true` |
| 顶栏品牌/「我的事」链接(`app-shell.tsx:28` 裸 `<a href="/">`) | FAIL(同上硬导航) | FAIL | FAIL | PASS | FAIL | 同上机制 |
| popout(`window.open('/chat')`) | 弹窗是新实例草稿为空;开窗者草稿保留 | 开窗者继续;两窗各自实例并行 | 开窗者 PASS | PASS(弹窗采纳同一 localStorage sessionId,头显「会话 t56s3-sh」) | PASS(带漂移风险:双窗并行最后写赢) | persist 6a/6b;popout-session.mjs |
| 硬导航去 `/chat` 再回 | FAIL(草稿丢) | FAIL | FAIL | PASS(/chat 页实例采纳同一 sessionId) | FAIL(会话标识连续,但实例无存续) | persist 8a/8b |
| 页面刷新 | FAIL(预期,assistant-ui 内存态) | FAIL(服务端循环继续;`pendingSession` 标记供 history 显示 running) | FAIL | PASS | PASS(会话/历史可恢复) | use-chat-session.ts:97-104;未实测 history 轮询(见 NOT RUN) |

补充现状行为(P2 交互设计输入):

- **重开不回停靠**:进线首次展开自动 sidebar;收起再展开时 `dockedThread` 已记住本线,
  不再强制(`floating-chat.tsx:86-91`),形态取 localStorage(缺省 float)——
  「尊重用户当次选择」这条现状是对的,P2 自适应停靠不要丢掉它。
- **会话列表切换**会 abort 在途请求(`use-chat-session.ts:576-589`),本次仅代码级核对,未跑探针。

### 2.1 受控 SSE 实测(`probes/scripts/s3-sse.mjs`)

模拟口径(如实声明):`.env.local` 含真实 LLM key,为不耗配额,**未向真实 /api/chat 发送**;
用 `addInitScript` 包装 `window.fetch`,仅对 POST `/api/chat` 注入协议正确帧
(session → step×12 @700ms → final,ReadableStream 真实分块、尊重 abort)。
下游(消息态、isRunning、停止、localStorage 持久化、布局)全是真实产品代码。

- 流式期间依次:收起 → 重开(float)→ 停靠 → 客户端导航离开 → 后退:
  每步 `stopVisible=true`、`aborted=0`,流最终 `completed=1`,isRunning 复位,发送键回归 → **存续 PASS**。
- session 帧到达即写 `localStorage['ui4a.chat.sessionId']`(实测 t56s3-sse-*)→ 会话标识即时连续。
- 停止:流中点「停止」→ shim abort 计数 +1、追加「已停止」、发送键回归 → **停止能力 PASS**
  (390px 窄屏例外:按钮存在但被挤出视口,见矩阵)。
- final.summary 未追加是**正确行为**非丢失:12 个直出文本步(`activity` 缺省)使
  `machineTextSteps>0`,`handleFinal` 刻意不补 summary 防(`use-chat-session.ts:287-325`);
  final 的其余效果(persistSession/pending 清除/isRunning=false)全部落地。
- 探针 shim 每回合铸新 sessionId(忽略请求体内回传),真实服务端会回显同 sessionId——
  矩阵中「会话选择」结论以单回合与 localStorage 连续性为准,shim 伪影不计。

## 3. clientView 漂移(`probes/scripts/s3-clientview-keyboard.mjs`)

发送时 clientView 由真实代码 `clientViewReportForLocation`(window.location)捕获,实测:

| 发送时 URL | clientView.presence | 漂移 |
| --- | --- | --- |
| `/canvas?thread=t56s3-a2c71f&focus=thread:t56s3-a2c71f` | thread=`t56s3-a2c71f`,focus=`thread:t56s3-a2c71f` | 无,与 URL 一致 |
| `/canvas?thread=t56s3-a2c71f&focus=articles`(书桌条目硬导航后) | thread=`t56s3-a2c71f`,focus=`articles` | 无,与 URL 一致 |
| `/canvas`(客户端导航丢参数) | thread=null,focus=null | 无漂移,但**工作线上下文随 URL 丢失**(D46 语义,发送视角诚实) |

- **输入区附近的当前线/对象提示:现状不存在**(CV4:`当前查看`/`当前线`/thread id 均不在
  面板文案中)。唯一上下文线索是服务端 focus/render 帧驱动的「当前查看:<rel>」链接
  (`chat-panel.tsx:209-217`),它反映**上一回合**的落点,不是当前 URL。FR7「输入附近可查看
  当前工作线/对象,与实际发送的 clientView 一致」——发送侧一致(都来自 URL 单一来源),
  展示侧缺口(P2/P3 需补常显提示,数据源即 URL observation,勿新造 store)。

## 4. 焦点与键盘(现状记录)

- FAB 展开后焦点**不进面板**(activeElement=body)——无初始焦点管理。
- Tab 圈:composer 区 `TEXTAREA → 委托模式 → 发送`,顺序正常;按钮带 `focus-visible:ring` 类。
- **Escape 在 float 与 sidebar 形态都不关闭面板**(无 keydown 处理)——design §1 覆盖层
  要求(Escape 关闭)现状不满足。
- X 收起后焦点落在 body,**无焦点恢复**到触发点(FAB/原元素)。
- 收起再展开的形态语义见 §2 补充;均为现状记录,P2 覆盖层交互(明确关闭/Escape/焦点恢复/
  焦点圈/不依赖 hover)需整组补齐。

## 5. 视口×布局现状问题清单(对应 F01,DoD 出口)

1. **F01 实锤**:1080×820 进线(自动停靠)三栏 = 384(书桌)+ 240(注视)+ 384(助手),
   中栏最窄;1280 下注视 440 也不达 640。截图 `1080x820-thread-itself-chat.png`。
2. **640px 下限结构性不可达**:main `max-w-5xl`(1024)+ 书桌 384 + padding/gap 72 → 关 chat
   也只有 568,任何视口都低于 640。P2 必须去掉永久材料栏并重审 main 封顶与注视列的关系。
3. **390px 双违规**:sidebar 停靠 → body 横滚(docSW 584)+ 注视 152;float → 面板左缘
   x=−10 裁出屏。无 Escape、无焦点恢复。
4. **768px**:书桌已堆叠整宽,但 chat 停靠仍把唯一主列挤到 336(「手机主面使用可用全宽」违反)。
5. **200% 缩放(960 CSS)**:与 768 同型,注视 528 < 640 → 200% 下必须覆盖模式(阈值见 §1.2)。
6. **H1 清点**:本线页 0 个 h1(身份在 h2);对象页 2 个 h1(`共同注视`+对象名)——
   design「唯一主要 H1」两个方向都不满足(机制标题压过/替代业务标题,F04 同源)。
7. 助手 `w-96`=384px 超 design 建议上限(380)4px;非阻断。
8. 书桌条目/品牌链接为裸 `<a>` 硬导航,矩阵两项 FAIL 的根因(见 §6)。

## 6. 唯一 chat 状态拥有者定案建议(不引入新状态库)

现状(实测+代码):`useChatSession` 每次 mount 一份;工作站点只有两个宿主——
根布局 FloatingChat(`app/layout.tsx:20`)与 `/chat` 独立页;跨「文档」只有
localStorage(sessionId/pendingSession/chat.mode)与服务端事件日志投影。实测矩阵证明:
**单文档内所有布局切换都存续(拥有者=根布局实例),一切整页加载都丢草稿/在途**。

定案建议:

1. **根布局 FloatingChat 内的 `useChatSession` 是工作站点唯一拥有者**,P2 响应式
   (sidebar/float/overlay/单面)只准换壳不准换宿主;`/chat` 维持为显式第二宿主
   (独立窗口形态),两宿主仅以 sessionId(localStorage)+ 服务端日志对齐(D68:
   sessionId 只是分组键,日志是真相)——现状架构即满足,不需要也不应加跨窗实时同步。
2. **消除硬导航是存续契约(FR7)的前置**:书桌条目(`thread-desk.tsx:290`)与壳内
   `<a href>` 改 Next Link 客户端导航;这一条不修,任何响应式方案都会在切对象时丢草稿。
3. 草稿跨刷新/跨窗不要求存续(接受现状);若产品要刷新保草稿,用 sessionStorage 按
   sessionId 键存 composer 文本即可,不建新状态库(本探针未实现,仅记录选项)。
4. P2 自适应停靠:用 §1.2 剩余宽度条件替换「进线必停靠」,并保留「用户收起后本线内不再
   强制」的 dockedThread 记忆(实测现状已正确)。
5. 不把布局形态切换伪装成业务 mutation,也不把 thread 用作会话 key(现状已是
   principal×sessionId,继续)。

## 7. P2 Red 测试落位建议(DoD 出口)

- **`e2e/workstation/work-thread-workspace.spec.ts`**(P4.1 计划新建,现不存在):
  几何门禁——六个视口配置下注视列 ≥640 且 ≥60%(并排时)、无 body 横滚、h1 数 ≤1、
  390 覆盖助手不超屏且有 Escape/焦点恢复;数据表直接以本报告 §1 为期望值基线。
- **chat 存续**:新建 `e2e/workstation/chat-session-continuity.spec.ts`(或并入上述文件):
  用 `probes/scripts/s3-sse.mjs` 的 fetch-shim 手法(可先转正为 `e2e/kits/chat-sse-shim.ts`)
  跑 §2 矩阵的 Red 版(书桌条目客户端导航、流中收起/重开/缩放、停止可达)。
- **组件级**:`apps/web/src/components/chat/floating-chat.test.tsx` 追加停靠阈值/形态记忆用例;
  书桌条目导航方式用 `apps/web/src/components/canvas/desk/thread-desk.test.tsx` 断言
  (Link 而非裸 `<a>`)。**GR3 警示**:`apps/web/src/chat` 3974/4000、
  `apps/web/src/components` 3772/4000——新增测试按 D53 落相邻子目录,勿堆原目录。
- 真实 SSE 网络路径与 history join 不在 P2 范围(S2/US12 真实 LLM 门禁覆盖)。

## 8. 探针代码去向(DoD-5/6)

- **转正**:`probes/scripts/` 下 5 个只读探针脚本(运行于 3110 隔离栈,产物即本报告数据):
  `s3-geometry.mjs`(几何+截图)、`s3-persist.mjs`(存续矩阵)、`s3-sse.mjs`(受控 SSE)、
  `s3-clientview-keyboard.mjs`(clientView/键盘)、`s3-popout-session.mjs`(/chat 会话采纳)。
  保留理由:P2 Red 测试的直接母本(shim/选择器/阈值断言可复用);均为 .mjs 探针,不计 GR3 源码行数。
- **删除**:`/tmp/t56s3/`(临时目录,含被 s3-geometry.mjs 取代的初版 geometry.mjs)、
  `apps/web/.next-t56s3/`(603MB 构建产物,git-ignored)。
- **截图**:`probes/shots/` 34 张(5 视口×2 route×closed/chat + 6 张 float 形态 + 4 张 SSE 现场),
  文件名即「视口-route-状态」;`1080x820-thread-itself-chat.png`(F01)、
  `390x844-chat-float.png`(面板裁边)、`sse-4-narrow-390-streaming.png`(停止键不可视)为关键证据。

## 9. NOT RUN(不得当作已验证)

- **真实服务端 SSE 全链路未测**:`.env.local` 有真实 LLM key,为不耗用户配额,流式行为全部
  经协议正确帧注入(fetch shim);服务端 chat-turn 落库、history join、pendingSession 轮询
  恢复未验证(S2/US12 范围)。
- 真实 LLM 回答质量、委托(delegated)模式(Temporal/worker 未起)、eval 门禁:未跑(非目标)。
- 200% 缩放 = 960×540 CSS 视口 + deviceScaleFactor 2 等效模拟(布局视口等价);
  真实浏览器 Ctrl/⌘ 缩放交互未用。
- SessionList 切会话 abort、读屏器/真人键盘走查、打印/RTL:未测(仅程序化 Tab/Escape 与代码核对)。
- 用户 3100 dev server 的渲染内容与本 HEAD 的一致性未验证(未触碰);dev 库、ui4a_test、
  7233/7235 未写入、未重启。
- `ui4a_s3_test` 库保留(供并行复核);如需清理由编排 agent 决定
  (`DROP DATABASE ui4a_s3_test`)。

## 10. git status(结束时全列,DoD-5)

```
 M conductor/tracks/t56-work-thread-workspace_20260905/plan.md        (编排 agent 既有改动)
?? apps/web/src/app/api/chat/history/s2-probe.test.ts                 (S2 并行任务产物)
?? apps/web/src/components/chat/citation-list.s2-probe.test.tsx       (S2 并行任务产物)
?? apps/web/src/components/chat/history-replay.s2-probe.test.tsx      (S2 并行任务产物)
?? apps/web/src/engine/service-tests/work-thread/                     (S1/S2 并行任务产物)
?? conductor/tracks/t56-work-thread-workspace_20260905/probes/        (S1+S3 探针产物:本任务写
                                                                       s3-layout-session.md、
                                                                       shots/、scripts/ 5 个 .mjs)
```

本任务自起进程已全部正常结束(3110 释放,`lsof` 复核);`apps/web/tsconfig.json` 已还原;
未 commit 任何内容。
