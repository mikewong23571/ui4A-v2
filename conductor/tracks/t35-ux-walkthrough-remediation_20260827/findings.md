# T35 问题实情台账(findings)

> 本文件是 T35 的**持续问题实情记录**,唯一事实来源。规则:
> 1. 每个发现一个问题编号 `F-XX`,只增不改号;内容按「现象→复现→证据→初步根因→处置」如实记录,宁可写"未定位"也不猜测;
> 2. 状态机:`open → locating → fixing → fixed-pending-recheck → rechecked(关闭) / wontfix(须注记理由)`;
> 3. 每条证据必须指向本 track `evidence/` 下的截图或可复现的操作序列;
> 4. 视觉复验依据 `user-stories.md` 对应故事,由编排 agent 浏览器实测并截图回填「复验记录」;
> 5. 试用中发现新问题随时追加,不因修复轮次关闭而停止。

---

## 试用轮次索引

| 轮次 | 日期 | 环境 | 范围 | 新增 |
|---|---|---|---|---|
| R1 初始全站走查 | 2026-08-27 | 本地 dev(源码 e7891f1,web:3100) | 我的事/画布/定义管理/聊天/系统页/顶栏/历史会话 | F-01~F-16 |

---

## F-01 动作成功后界面无反馈,页内"重新载入"也不刷新(P0)

- **状态**: rechecked(2026-08-27 关闭)
- **严重度**: P0(操作闭环断裂,系统性复现)
- **发现**: R1(2026-08-27)
- **现象**: 点击"下线"后 `POST /api/exec` 返回 200、服务端实体已变 `offline`(API 实证),但界面纹丝不动:无 toast、无状态变化、按钮原样。点击页内"重新载入"后依旧显示 published——presentation 重新规划仍命中同一 `sidecarId`(日志:exec 前后 `GET /api/presentation/sidecar?sidecarId=sidecar:fde7c230…` 相同)。仅浏览器整页刷新后才显示真实状态。"批准"确认、"创建工作线"、"重新发布"全部同样复现(批准后服务端 `status: approved`,卡片仍挂着待批按钮)。
- **复现**: ① 画布打开任一 published 文章 → 点"下线" → 观察无反馈;② 点"重新载入" → 仍 published;③ F5 整页刷新 → 变 offline/重新发布。首页"批准"同构。
- **证据**: `evidence/2026-08-27-initial-walkthrough/05_after_unpublish_no_feedback.png`、`06_in_app_reload_still_stale.png`、`07_hard_reload_shows_offline.png`、`22_create_thread_no_feedback.png`;dev 日志 `POST /api/exec 200` 与同 id sidecar 复用记录。
- **初步根因**: exec 成功后未失效相关 sidecar/实体缓存,surface 不重取;UI 层也没有动作结果回执的呈现通道(成功/拒绝都不可见)。
- **处置**: plan Phase A;复验故事 S2/S3/S4。
- **修复记录(2026-08-27,commit 65525c3)**: 根因=画布双提交路径分叉——A2UI 原生动作走 canvas-action-handler(失效+reload),而词汇动作组(detail/member 词条 ActionGroup)走 surfaceSubmit,成功后零失效零重载。修复=PresentationSurfaceHost 的 surfaceSubmit 统一接 executed 协议(精确失效 rel+collection 回链 → 整面 reload);单测锁定第二次规划与失效重取(原 fresh-read 断言 +1 → +2)。治理:baseline +6 业务优先登记(12a9658)。
- **复验记录**: 2026-08-27 浏览器实测(post:first-post 下线→offline+重新发布 当场呈现;重新发布→published 还原;创建工作线 计数 1→2 当场入列)。故事 S2/S3 正式验收待 Phase F 全量走查;截图 `evidence/2026-08-27-phase-a/`(待补)。

## F-02 meta"查看活实例"死链,并污染聊天注视(P0)

- **状态**: rechecked(2026-08-27 关闭)
- **严重度**: P0(跨面闭环断裂 + 连带破坏产品示例场景)
- **发现**: R1(2026-08-27)
- **现象**: meta 流程详情顶栏"查看活实例"指向 `/canvas?focus=flow:post-status&scope=publishing`;该 focus 实体不存在(flow 定义不是实例),画布整页只剩一行红字"部分内容暂时无法显示"。此后在聊天发送首页建议的示例任务「发布一篇文章」,助手失败:"发布文章失败,因为实体 \"flow:post-status\" 不存在"——无效注视写入了会话上下文。
- **复现**: 定义管理 → 流程定义 → post-status → 顶栏"查看活实例" → 空页;随后展开聊天发送「发布一篇文章」→ 失败。
- **证据**: `evidence/2026-08-27-initial-walkthrough/12_cross_plane_dead_end.png`、`15_chat_fail_flow_gaze.png`。
- **初步根因**: 链接生成把 flow 定义 rel 直接当实例 focus;无效 gaze 的持久化/透传无拦截。
- **处置**: plan Phase B;复验故事 S5。
- **修复记录(2026-08-27,commit 6b70656)**: 根因=根因:根因=sitemap 声明了 `flow:<name>` 表面但服务层只在恰一实例(向导语义)时兑现,状态机类 flow(零/多实例)404。修复=服务层新增只读实例集合投影 `flowInstancesCollection`(成员=实例自身快照字段,零新真相;未知 flow 名保持 404);画布 focus 不可解析时呈现结构化空态(D51 中性口径+返回首页,机制细节只进 why 抽屉);同文错误行聚合去重(为 F-03 的呈现面先行收口)。
- **复验记录**: 2026-08-27 浏览器实测:`/canvas?focus=flow:post-status` 呈现 3 个活实例成员(可点);未知 rel 呈现空态卡(中性措辞+返回首页,无裸 rel)。故事 S5 正式验收待 Phase F;截图 `evidence/2026-08-27-phase-b/`。成员标签当前显示 raw rel(业务 identity 缺席),转 F-05/D 轮成员标签口径处理。

## F-03 起草向导 surface deref 失败,画布堆叠重复错误行(P0)

- **状态**: fixing
- **严重度**: P0(AI-first 下人类视觉协作面失效)
- **发现**: R1(2026-08-27)
- **现象**: 聊天驱动 `flow:article-drafting` 推进时,画布对应 surface 渲染 4~5 行一模一样的斜体"部分内容暂时无法显示",不聚合、不可操作。诊断面板:4~5 条 `deref-failed · region-node:subject:word-N: binding "value"/"actions"/"links" resolved to undefined`。聊天能完成发布(文章实证已发布),但人全程只能靠打字,画布不可用。
- **复现**: 聊天发布文章流程推进到 title/category 确认后观察画布。
- **证据**: `evidence/2026-08-27-initial-walkthrough/17_canvas_4_errors.png`、`19_disclosure_presentation_controls.png`、`18_chat_evidence_paths.png`。
- **初步根因**: 向导 subject 区域的 deref 引用在无实例/新实例状态下解析为 undefined;错误呈现按词元逐条渲染,无聚合。
- **处置**: plan Phase C;复验故事 S6。

## F-04 代理循环执行与会话结果错标(P0)

- **状态**: fixing
- **严重度**: P0(结果可信度)
- **发现**: R1(2026-08-27)
- **现象**: 助手在文章已发布(服务端实证)后继续执行"下一步/完成编辑/publish"多轮(步骤 7+ 未收敛),需手动停止;停止后历史会话将该会话标为"失败",而其业务结果实际成功——状态标签与事实相反。另一会话(被 F-02 污染的那次)标"失败"属实。
- **复现**: 聊天完成一次完整发布后观察步骤流;停止后打开"历史会话"。
- **证据**: `evidence/2026-08-27-initial-walkthrough/28_session_history_false_failed.png`。
- **初步根因**: ① 助手读不到自身进度的可靠投影(可能受 F-03 deref 影响)导致重复决策;② 会话/turn 的成败以"最后 turn 是否正常结束"为准,未对齐业务结果。
- **处置**: plan Phase C;复验故事 S6。

## F-05 术语体系混乱:一物多名(P1)

- **状态**: open
- **严重度**: P1(业务概念清晰度)
- **发现**: R1(2026-08-27)
- **现象**: 同一概念最多四个名字:① 内容协作区 = nav"共同注视"/页题"画布"/内容题"articles"/处境条"workstation";② 治理面 = nav"定义管理"/页题"定义控制台"/眉题"META HUMAN CONTROL PLANE"/分组"定义站";③ 注意力焦点 = "注视"/focus/"当前查看"/scope 混用;④ 流程实例 = 列表 raw id(post-status)/详情中文"文章状态";⑤ 委托 = "委托"/delegations/"在动"。
- **复现**: 对照导航、页面标题、卡片标题即可见。
- **证据**: `evidence/2026-08-27-initial-walkthrough/03_canvas.png`、`08_meta_console.png`、`09_meta_flows_list.png`、`10_flow_post_status.png`。
- **处置**: plan Phase D(统一术语表);复验故事 S1/S7。

## F-06 重复噪音:样板句 ×N、计数 ×2、self 空卡(P1)

- **状态**: open
- **严重度**: P1(重复原则)
- **发现**: R1(2026-08-27)
- **现象**: ①"你和助手使用同一合同,由同一规则裁决"在每个动作组重复,一页 3~5 次;② 每个区块标题下计数数字渲染两遍("1"/"1");③ 每个区块附带 `self` 徽章空链接卡(空区块也不例外);④ 错误行逐条原样堆叠(见 F-03)。
- **证据**: `evidence/2026-08-27-initial-walkthrough/01_home_top.png`、`02_home_bottom.png`。
- **处置**: plan Phase D;复验故事 S1。

## F-07 动作无视觉层级:破坏性与普通操作同级(P1)

- **状态**: open
- **严重度**: P1(对比原则)
- **发现**: R1(2026-08-27)
- **现象**: 所有动作(含"归档工作线""暂停工作线"等不可逆/重要操作)都是同等描边灰按钮,且每个独占整行、行高巨大,像列表行不像按钮;主/次/危险三级不可辨。深灰底上说明文字对比度偏低。
- **证据**: `evidence/2026-08-27-initial-walkthrough/02_home_bottom.png`、`27_thread_focus.png`。
- **处置**: plan Phase D/E;复验故事 S1/S8。

## F-08 "填写XX参数"按钮命名与聊天占位文案泄漏机制(P1)

- **状态**: open
- **严重度**: P1(文案)
- **发现**: R1(2026-08-27);用户确认(2026-08-27):"填写挂载引用参数,填写卸载引用参数 这两个我觉得也挺奇怪的"
- **现象**: ① 两段式提交的机制被当按钮名:"填写挂载引用参数/填写卸载引用参数/填写创建工作线参数"——通用框架 `填写{action.title}参数`(action-runner.tsx,D47.1 口径)拼上机械动词 title("挂载引用/卸载引用",work-thread 定义数据)后尤其别扭;② 聊天空态"输入目标委托 agent(走 HTTP 合同),如「发布一篇文章」"把 HTTP 合同写给终端用户;③ 输入行同时存在"委托"与"发送"两个提交控件,语义不清;④ 创建工作线表单要求用户自造"工作线标识",无占位/说明,必填项零提示。
- **修复方向(遵守文案滑梯)**: 双层修——(a)合同数据层:work-thread 等定义的动作 title 中文化为业务语(如 挂载引用→添加引用、卸载引用→移除引用);(b)通用框架层:带参数动作的触发键不再用"填写…参数"句式,改为动作 title 本身 + 打开表单的视觉可供性(具体形态 Phase D 视觉定稿),框架改动一处全局生效,零逐按钮特判。
- **证据**: `evidence/2026-08-27-initial-walkthrough/14_chat_open.png`、`21_create_thread_form.png`、`27_thread_focus.png`。
- **处置**: plan Phase D(D3);复验故事 S4/S8。

## F-09 助手话术与证据引用泄漏内部结构(P1)

- **状态**: open
- **严重度**: P1(文案/概念)
- **发现**: R1(2026-08-27)
- **现象**: 助手澄清语"发布流程需要先填写文章标题(当前实体的 next 动作必填字段 title)","(next 动作必填:tech / essay / review)";"依据"chips 直接展示 JSON path(`article-drafting:main/properties/fields`)。聊天底栏"当前查看:flow:article-drafting"裸 URN。
- **证据**: `evidence/2026-08-27-initial-walkthrough/16_chat_ask_title.png`、`18_chat_evidence_paths.png`。
- **处置**: plan Phase D;复验故事 S6。

## F-10 守卫禁用原因显示 raw 表达式(P1)

- **状态**: open
- **严重度**: P1(文案;诚实机制本身是优点)
- **发现**: R1(2026-08-27)
- **现象**: 流程详情"废弃"按钮禁用并显示原因——机制正确,但文案是"guard 不满足: no-live-instances=false",应说人话("还有进行中的文章,不能废弃")。
- **证据**: `evidence/2026-08-27-initial-walkthrough/11_flow_actions_guard.png`。
- **处置**: plan Phase D;复验故事 S7。

## F-11 工作线详情页业务信息缺席(P1)

- **状态**: open
- **严重度**: P1(亲密原则/概念表达)
- **发现**: R1(2026-08-27)
- **现象**: `canvas?focus=thread:cve-0827` 页标题是 URN `thread:cve-0827`(业务标题"处理 webflux 批次 CVE"不在场);页面只有一摞动作按钮 + self 链接卡,无目标、无状态人话、无挂载引用、无近期事件。"停在家『open』"+ `open · thread:cve-0827` 双重暴露原始状态。
- **初步根因**: 工作站的陈列轴是机器平面(实体种类),不是"事";线详情只渲染了动作区,T26 已投影的 goal/引用/进行中/待批准/事件切片未被组装成叙述。设计层审查见 `design-notes.md`(业务目标四承载层:身份/参照系/共同处境/结案回执)。
- **证据**: `evidence/2026-08-27-initial-walkthrough/27_thread_focus.png`。
- **处置**: plan Phase E(S8 = 叙述页最小实现);"首页书桌化"登记为方向项,超出首轮 scope;复验故事 S8。

## F-12 "声明的处境"条与"调整声明"弹层过简(P2)

- **状态**: open
- **严重度**: P2
- **发现**: R1(2026-08-27)
- **现象**: 常驻条文案"你在 URL 中声明的处境 + scope 未声明/工作线 未声明/注视 未声明"术语裸奔;标签与值字重相同难区分;"调整声明"弹层仅一句"URL 声明不代表已授权"+一个空输入框,不给合法值(scope 可选集合)、无应用按钮说明。
- **证据**: `evidence/2026-08-27-initial-walkthrough/26_adjust_declaration.png`。
- **处置**: 待排期(Phase D 顺带或后续轮次);复验故事 S1。

## F-13 导航细节:下拉不收起、刷新动词不一(P2)

- **状态**: open
- **严重度**: P2
- **发现**: R1(2026-08-27)
- **现象**: "系统"下拉点击菜单项跳转后菜单仍展开盖住内容;画布页叫"重新载入"、委托监控页叫"刷新"。
- **证据**: `evidence/2026-08-27-initial-walkthrough/23_delegations.png`、`24_events_stream.png`。
- **处置**: 待排期(Phase D 顺带)。

## F-14 原始实体页把 presentation JSON 当属性值展示(P2)

- **状态**: open
- **严重度**: P2
- **发现**: R1(2026-08-27)
- **现象**: `/entity?rel=inbox` 属性表内嵌 `presentation` 字段的 JSON 原文。
- **证据**: `evidence/2026-08-27-initial-walkthrough/25_raw_entity_inbox.png`。
- **处置**: 待排期。

## F-15 首页出现两个同名"创建工作线"按钮(P2)

- **状态**: open
- **严重度**: P2(疑似重复渲染)
- **发现**: R1(2026-08-27)
- **现象**: `getByRole('button', {name:'创建工作线'})` 命中 2 个,其一视觉不可见(疑似隐藏 surface 重复渲染同一动作)。
- **证据**: `evidence/2026-08-27-initial-walkthrough/21_create_thread_form.png`(DOM 探测记录)。
- **处置**: 随 Phase A/D 排查去重。

## F-16 开发注释文案出现在界面(P2)

- **状态**: open
- **严重度**: P2
- **发现**: R1(2026-08-27)
- **现象**: meta 控制台"本地演示身份:Scope 由服务端 allowlist 约束,不代表生产 SSO";流程页横幅"通用合同视图…不冒充特化体验"("不冒充"用词怪);诊断面板暴露 `https://ui4a.dev/render/v1/catalog.json` 占位目录协议。
- **证据**: `evidence/2026-08-27-initial-walkthrough/08_meta_console.png`、`13_disclosure_panel.png`。
- **处置**: 待排期(Phase D 顺带)。


## F-18 导航无当前项指示(P1)

- **状态**: open
- **严重度**: P1(对比/定位)
- **发现**: 用户反馈(2026-08-28):"没有 hint 表明当前在我的事,共同注视,定义管理,系统的哪一个"
- **现象**: `site-nav.tsx` 全部链接固定 `text-muted-foreground`,不用 `usePathname()` 判定当前路由,无 aria-current/active 样式;用户无法一眼定位自己站在哪个区。
- **修复方向(Phase D)**: 以 `usePathname()` 派生当前项(前缀匹配:/=我的事,/canvas=共同注视,/meta*=定义管理,系统下拉项按各自路径);当前项加 aria-current="page" + foreground 字重/底色,非当前项保持弱化;零特判逻辑(纯路由前缀映射表)。
- **证据**: `evidence/2026-08-27-initial-walkthrough/01_home_top.png`(导航区无任何 active 迹象)。

## F-19 "系统"下拉交互与样式低质(P2)

- **状态**: open
- **严重度**: P2
- **发现**: 用户反馈(2026-08-28):"系统那个下拉效果很垃圾;很low"
- **现象**: 原生 `<details>` + 文本字符"⌄"做箭头;展开层为 absolute popover,无动画/无对齐收口;导航后不自动收起(F-13 已记);点击外部区域不关闭;`text-sm` 下拉项与主链接同款 hover,层级感缺失。
- **修复方向(Phase D,与 F-13 合并)**: 换 shadcn DropdownMenu(Radix,已有 ui 基座):触发键用 ChevronDown 图标 + aria-expanded;菜单项带图标与说明;路由变化自动收起;点击外部关闭;menu 样式与 meta 控制台卡片区同阶(shadow-md + rounded-lg + min-w)。箭头字符"⌄"从代码库清退。
- **证据**: `evidence/2026-08-27-initial-walkthrough/23_delegations.png`(菜单悬浮不收)。


---

## R2 试用轮(2026-08-28,S9–S11 新应用创建与独立审查)

| 轮次 | 日期 | 环境 | 范围 | 新增 |
|---|---|---|---|---|
| R2 新应用独立审查 | 2026-08-28 | 本地 dev(bundle v4,新库) | todo/ideas 全生命周期 + meta 草稿修订闭环 | F-20~F-21(F-17 于本轮发现并当场修复) |

## F-17 flow 别名导致动作适配器 subject-mismatch 误拒(P0,已修复)

- **状态**: rechecked(2026-08-27 关闭,commit 见 fix t35 F-17)
- **发现**: R2(2026-08-27,S9 首次捕捉实测)
- **现象**: 向导表单提交报机械错 "[subject-mismatch] Reloaded entity does not identify itself as \"flow:todo-capture\""——surface 动作适配器 fresh-read 按注视 subject 发起,服务端 flow 别名以实例 rel 返回,适配器按 rel 相等性拒绝。
- **修复**: action-adapter 采纳服务端返回实体的规范 rel 作为 exec 目标(服务端是身份权威;action/guard/schema 校验仍全部针对返回实体,失败保持关闭);单测锁定别名提交与 refreshSubjects 双侧覆盖。
- **复验记录**: 2026-08-28 新库实测捕捉闭环全通;截图 `evidence/2026-08-28-S9S10/`。

## F-20 meta 加动作草稿静默丢动作(P1)

- **状态**: open
- **严重度**: P1(产品内治理路径的正确性)
- **发现**: R2(2026-08-28,S11 激活后实测)
- **现象**: S11 修订流程(加动作 restore→archived 节点)→提交校验→人类批准→v2 激活,全链路留痕完整;但激活后的 v2 定义里 archived 节点为空——加动作表单只收 node/name/title/to/method,不声明 effect(transition),组稿管线把无 effect 声明的动作静默丢弃,校验器九项检查全部放行。结果:人类批准了一个与预期不符的定义。
- **复现**: meta → todo-item → 修订 → 填写加动作参数(archived/restore/恢复/open) → 提交校验 → 批准激活 → 查看 v2 定义 archived 节点为空。
- **证据**: `evidence/2026-08-28-S9S10/`(S11 激活截图);事件 97/99(definition-revised/definition-submitted)。
- **处置**: 待排期(建议与 D 轮并行修:加动作表单补 effect/transition 声明,或校验器对"有 to 无 effect"报 invalid);修复前 findings 挂账。

## F-21 集合成员状态显示机器节点名而非节点标题(P1)

- **状态**: open
- **严重度**: P1(任务语言,F-05 家族)
- **发现**: R2(2026-08-28)
- **现象**: todos/ideas 集合成员卡显示 `open · todo:t35`、`developing · idea:item`——流程定义里节点明明有中文 title(进行中/已捕捉/发展中),成员卡用的是 node NAME。article 集合同样(published/offline)。
- **修复方向**: 成员卡状态投影按出生定义取节点 title(合同数据插值,D47.1);节点名至多进 title 悬浮。
- **证据**: `evidence/2026-08-28-S9S10/S9_completed_reopen.png`。

---

## 复验记录(回填区)

(暂无;每条 fixed-pending-recheck 的问题按 user-stories.md 对应故事复验后,在此回填日期、故事号、截图路径与结论。)
