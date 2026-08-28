# T35 问题实情台账(findings)

> 本文件是 T35 的**持续问题实情记录**,唯一事实来源。规则:
> 1. 每个发现一个问题编号 `F-XX`,只增不改号;内容按「现象→复现→证据→初步根因→处置」如实记录,宁可写"未定位"也不猜测;
> 2. 状态机:`open → locating → fixing → fixed-pending-recheck → rechecked(关闭) / wontfix(须注记理由)`;
> 3. 每条证据必须指向本 track `evidence/` 下的截图或可复现的操作序列;
> 4. 视觉复验依据 `user-stories.md` 对应故事,由编排 agent 浏览器实测并截图回填「复验记录」;
> 5. 试用中发现新问题随时追加,不因修复轮次关闭而停止。

---

## 问题地图(截至 2026-08-28,对话全量汇总)

**已修复并复验(6)**: F-01 动作后无反馈/不刷新 · F-02 查看活实例死链 · F-03 向导面
deref 失败+错误堆叠 · F-04 代理循环重试(收敛护栏;会话"失败"标注经核实为诚实) ·
F-17 别名动作 subject-mismatch 误拒 · F-15 双创建按钮(随 D-2 复查)。

**P0 未修(2)**:
- F-23 应用不可达 → E-2:sitemap 派生应用入口区 + pin(F-26) + 阈值收缩;
- F-27 thread 动作无对象无价值叙事 → E-1:叙述页 + 材料清单 + 对象选择器 +
  任务语标题(裸填表单退位)。

**P1 未修(按执行波次)**:
- E 轮(工作台地基): E0 蓝框误激活一行修(F-24a) · E-1 F-11 线叙述页 ·
  E-2/E-3 F-25 canvas 重定位(无注视=入口层,有注视=共读面) · F-24b dashboard
  分层(读面/写面视觉语言) · F-07 动作分组与危险分层;
- D 轮(表达收敛): D-1 术语表一物一名(F-05) · D-2 噪音删减+空态引导+成员状态
  标题化(F-06/21/24c) · D-3 动作/表单文案任务语(F-08) · D-4 聊天人话与证据
  分层(F-09) · D-5 守卫原因结构化转述(F-10) · D-6 导航当前项+系统下拉+
  刷新动词(F-13/18/19) · D-7 处境条芯片化(F-12,方案已认可,三补丁) ·
  D-8 分栏粘性视口列(F-22);
- 顺带: F-13/F-16 开发注释与细节、F-20 草稿加动作静默丢(校验器/表单补 effect)、
  F-26 文案一眼可读标准(全站验收线)。

**设计方向已定档(后续 track)**: ~~thread 工作台三栏/线内 pin/切线三路径/inline-委托话术~~ → **已提前并入本轨落地**(Phase W1–W4 完成);且经用户三轮追问,**pin 语义与布局定稿修订见 design-notes §十**(2 轨 + 1 舞台;pin=上下文引用非实时渲染;按钮跟着注视走)——§六/§七 与此不一致处以 §十 为准。

**原则红线(全程有效)**: 零每实体特判 · 渲染器零文案模板(文案滑梯,改合同数据) ·
处境单点装配 · 一切皆投影不加新真相 · 北极星为裁判文书。

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

- **状态**: fixed-pending-recheck(簿记数字退场/图例每面一次/self 弱化/空态引导归 Phase F 复验)
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

- **状态**: fixed-pending-recheck(文本面已修;结构化证据 chip/可展开审计层记残余)
- **严重度**: P1(文案/概念)
- **发现**: R1(2026-08-27)
- **现象**: 助手澄清语"发布流程需要先填写文章标题(当前实体的 next 动作必填字段 title)","(next 动作必填:tech / essay / review)";"依据"chips 直接展示 JSON path(`article-drafting:main/properties/fields`)。聊天底栏"当前查看:flow:article-drafting"裸 URN。
- **证据**: `evidence/2026-08-27-initial-walkthrough/16_chat_ask_title.png`、`18_chat_evidence_paths.png`。
- **处置**: plan Phase D;复验故事 S6。
- **修复记录(2026-08-28)**: 轨迹执行行不再携带参数 JSON(`执行 X(...) {"k":v}` → `已执行 X(...)`);参数全文留轨迹事件日志可审计,结果由实体投影呈现(§五 减暴露;inline/委托同一函数,逐条等值不破)。**残余(记为 D-4 二期)**: 证据引用 chip 化可点、JSON path 进可展开审计层——需聊天消息结构化(现 ChatMessage 为纯文本),随聊天面下轮迭代。## F-10 守卫禁用原因显示 raw 表达式(P1)

- **状态**: fixed-pending-recheck(Siren 面已修;exec 拒绝面保持机器串归 D-4 审计层)
- **严重度**: P1(文案;诚实机制本身是优点)
- **发现**: R1(2026-08-27)
- **现象**: 流程详情"废弃"按钮禁用并显示原因——机制正确,但文案是"guard 不满足: no-live-instances=false",应说人话("还有进行中的文章,不能废弃")。
- **证据**: `evidence/2026-08-27-initial-walkthrough/11_flow_actions_guard.png`。
- **处置**: plan Phase D;复验故事 S7。
- **修复记录(2026-08-28)**: 合同数据层新增 `GUARD_HINTS`(shared/definition/guards,平台守卫名→一行人话);Siren guard-results 的 reason 改为人话主句+机器表达式审计括号(`该内容尚未发布(guard 不满足: is-published=false)`),未登记守卫(应用域自定义如 item-ready)整体回退机器串零发明;组合函数 `guardBlockReason` 导出并单测双分支。exec 拒绝 reason(judge/confirmation/work-thread-command)保持机器串——那是 agent/审计面(D-4 口径),聊天展示层另 行处理。## F-11 工作线详情页业务信息缺席(P1)

- **状态**: fixed-pending-recheck(E-1 slice 1 已落地;清单内操作归 W)
- **严重度**: P1(亲密原则/概念表达)
- **发现**: R1(2026-08-27)
- **现象**: `canvas?focus=thread:cve-0827` 页标题是 URN `thread:cve-0827`(业务标题"处理 webflux 批次 CVE"不在场);页面只有一摞动作按钮 + self 链接卡,无目标、无状态人话、无挂载引用、无近期事件。"停在家『open』"+ `open · thread:cve-0827` 双重暴露原始状态。
- **初步根因**: 工作站的陈列轴是机器平面(实体种类),不是"事";线详情只渲染了动作区,T26 已投影的 goal/引用/进行中/待批准/事件切片未被组装成叙述。设计层审查见 `design-notes.md`(业务目标四承载层:身份/参照系/共同处境/结案回执)。
- **证据**: `evidence/2026-08-27-initial-walkthrough/27_thread_focus.png`。
- **处置**: plan Phase E(S8 = 叙述页最小实现);"首页书桌化"登记为方向项,超出首轮 scope;复验故事 S8。

## F-12 "声明的处境"条与"调整声明"弹层过简(P1,用户二次反馈升级)

- **状态**: fixed-pending-recheck(D-7 已落地;桥接迁内容上下文归 E-3/F-25)
- **严重度**: P1(用户 2026-08-28 二次反馈:"导航栏下面那一行小字也感觉挺没有设计感的;主要是,都是文字,而且比较长;同时,调整声明这个事情,是在干啥?用户不能理解的")
- **发现**: R1(2026-08-27);用户升级(2026-08-28)
- **现象**: ① 常驻条是纯文字 dl 表:"你在 URL 中声明的处境 + 站点 workstation + scope 未声明 + 工作线 未声明 + 注视 未声明 + 调整声明",无视觉设计、长度长、信息密度低;②"未声明"三项是默认态,却各占一个字段位——默认态不值得常显;③"调整声明"不可理解:用户不知道这是在干什么(URL 参数?授权?);"URL 声明不代表已授权"是实现话术。
- **重设计方向(Phase D/F,vision §三/§五口径)**:
  1. **常显收敛为状态芯片**:"⌂ 工作站"一级常显(你在哪);scope/工作线/注视仅在有值时以小 chip 串联(如"内容发布 · cve-0827");未声明不显示——"永远在场"的是处境本身,不是四个"未声明";
  2. **点芯片展开"当前在哪"弹层**: 四字段全量 + 跨面入口(查看活实例/在 meta 中编辑此定义) + 调整表单(scope 下拉给合法值集合,不用裸输入框);
  3. **文案任务化**: 去"URL 声明/调整声明"话术;授权语义只在弹层内一行说明("声明只影响你看到的内容,不改变权限");
  4. 字段标签值分层(标签弱化、值 foreground),chip 间距/留白对齐 meta 控制台。
- **证据**: `evidence/2026-08-27-initial-walkthrough/26_adjust_declaration.png`、`01_home_top.png`。
- **用户裁决(2026-08-28)**: 分析与方案**已认可**。执行时必须带三个补丁,否则芯片化会伤害共同注视目标:① chip 优先级/截断规则(注视值渲染业务标题、超长截断 hover 全量),且 **F-21/F-05 业务化命名先行**——否则芯片里全是 URN,是伪装成改进的倒退;② 跨面桥接链接(查看活实例/在 meta 中编辑此定义)不进弹层,迁到**内容上下文旁**(实例页放"看定义"、定义页放"看实例"),处境条只留状态;③ 注视 chip 有值时**免交互可见**(共同注视协议的人类半边),弹层内保留一句"助手与你在同一处境下工作"轻提示。
- **处置**: Phase D-3,顺序 = F-21 → 处境条重做(含三补丁) → 导航当前项/下拉;复验故事 S1。

## F-13 导航细节:下拉不收起、刷新动词不一(P2)

- **状态**: fixed-pending-recheck(受控弹出层已落地;刷新动词统一待 D-1)
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

- **状态**: fixed-pending-recheck
- **严重度**: P1(对比/定位)
- **发现**: 用户反馈(2026-08-28):"没有 hint 表明当前在我的事,共同注视,定义管理,系统的哪一个"
- **现象**: `site-nav.tsx` 全部链接固定 `text-muted-foreground`,不用 `usePathname()` 判定当前路由,无 aria-current/active 样式;用户无法一眼定位自己站在哪个区。
- **修复方向(Phase D)**: 以 `usePathname()` 派生当前项(前缀匹配:/=我的事,/canvas=共同注视,/meta*=定义管理,系统下拉项按各自路径);当前项加 aria-current="page" + foreground 字重/底色,非当前项保持弱化;零特判逻辑(纯路由前缀映射表)。
- **证据**: `evidence/2026-08-27-initial-walkthrough/01_home_top.png`(导航区无任何 active 迹象)。

## F-19 "系统"下拉交互与样式低质(P2)

- **状态**: fixed-pending-recheck
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
- **复现结论(2026-08-28,当前代码现场复验)**: **现码不可复现**。live 序列(revise → add-action{node:archived, action:{name:restore,to:open}} → submit)全链路通过:definition-edited 事件落库,工作副本中 restore 动作**携带派生 transition effect**(`actionEffects` 有 to 无 effect 时补 transition,core/parse.ts:343;normalizeAddedAction 经此规范化)。原现象的"组稿管线丢动作"在当前引擎路径不存在;原始 S11 事件(97/99)所在 dev 库已被 e2e I5 的 TRUNCATE 回灌重置(环境事实:e2e server-kit 默认 DATABASE_URL 指向 dev 沙箱 5433/ui4a,场景跑完 dev 数据即被压缩场景替换——数据可弃,但 R3 走查须知)。**终判归 R3**:按 S11 故事在干净种子世界上重跑完整 UI 修订序列,激活后核对 v2 archived 节点;复现则修,仍不可复现则本条转 wontfix(附证据)。

## F-21 集合成员状态显示机器节点名而非节点标题(P1)

- **状态**: fixed-pending-recheck(成员状态绑定已标题优先)
- **严重度**: P1(任务语言,F-05 家族)
- **发现**: R2(2026-08-28)
- **现象**: todos/ideas 集合成员卡显示 `open · todo:t35`、`developing · idea:item`——流程定义里节点明明有中文 title(进行中/已捕捉/发展中),成员卡用的是 node NAME。article 集合同样(published/offline)。
- **修复方向**: 成员卡状态投影按出生定义取节点 title(合同数据插值,D47.1);节点名至多进 title 悬浮。
- **证据**: `evidence/2026-08-28-S9S10/S9_completed_reopen.png`。


## F-22 分栏模式下左栏过长把聊天输入框推出屏幕(P1)

- **状态**: fixed-pending-recheck(根因实为停靠偏移未计处境条;top-12/dvh 修正+D-7 顶栏确定高度;长页复验归 Phase F)
- **严重度**: P1(布局闭环:聊天是主入口,输入框不可见即写通道断)
- **发现**: 用户反馈(2026-08-28)
- **现象**: 聊天切到「分栏」(sidebar 停靠)后,右栏是 AppShell flex 行里的普通文档流列;左栏(main)内容超过一屏时整页随文档滚动,右栏面板连同**底部输入框**一起滚出屏幕——助手写通道物理不可达。
- **根因**: aside 无 sticky/视口约束,面板高度跟随内容而非视口;输入框位于面板 flex 底部,面板顶端在长页面里不可见。
- **修复方向(设计手段,零新依赖)**: 分栏态 aside 改**粘性视口列**——`position: sticky; top: <顶栏高>; height: calc(100dvh - <顶栏高>); align-self: flex-start`,左栏保持文档滚动,右栏常驻视口;面板内部消息区 `flex-1 overflow-y-auto`、输入框 flex 底部固定。顶栏高在 F-12 芯片化(处境条收进导航行)后即为确定的 h-12,`top-12 h-[calc(100dvh-3rem)]` 可写死;用 `dvh` 兼容移动端动态工具栏。终局形态(出现更多 rail 时)才是 shell 级 `h-dvh overflow-hidden` 双栏独立滚动,当前不必做。
- **证据**: 浏览器现场 `/canvas?focus=todos&scope=todo` 分栏态(用户报告)。
- **处置**: Phase D-4(与 D-3 芯片化联动实现);复验故事 S6。


## F-23 workstation 无应用入口:新建应用不可达(P0)

- **状态**: open
- **严重度**: P0(业务闭环:应用创建了,用户却进不去——"应用即数据"的最后一公里断了)
- **发现**: 用户反馈(2026-08-28):"workstation 看不到其他的 application,默认展示 articles,这是问题,我发现我点了首页之后,不知道怎么进入 todo 页面了"
- **现象**: S9/S10 创建的 todo/ideas 应用在 workstation 首页零入口;首页区域只聚合 inbox/delegations/threads(articles 以工作线形式出现)。到达 todo 界面的唯一方式是手输 `/canvas?focus=flow:todo-capture&scope=todo`。
- **根因**: my-work 聚合声明(T27/T30 口径)没有"图书馆目录"层——书桌上只有当前事,但应用(sitemap applications + 各自 entry flow 与集合)没有任何投影入口。
- **修复方向(纯投影,零特判)**: 首页增一排**应用入口区**:从 sitemap `applications` 派生 chip/卡片(标题+intent 一句话),点入即该应用的 entry surface(focus=entry&scope=<name>);各应用的集合(todos/ideas)随 entry 到达。这是 design-notes"首页书桌化"方向项的第一小步(书桌+书架:当前线主角,其余应用是书架),需 my-work 声明版本升级(T30 口径),不动引擎。
- **证据**: 浏览器现场 `/`(首页无 todo/ideas 痕迹)。
- **处置**: Phase E-2(依赖 my-work 声明升级,与工作线叙述页同批);复验故事 S9/S10 的"可达性"判定。

## F-24 首页无 dashboard 层级:全 surface 蓝色描边 + 突兀的 0 计数(P1)

- **状态**: fixed-pending-recheck(蓝框误激活已修;簿记数字已退场;读/写面完整分层归 E 后续;R3 证据 `evidence/2026-08-28-R3/R3_home.png`)
- **严重度**: P1(视觉层级,用户反馈)
- **发现**: 用户反馈(2026-08-28):"进入我的事,整个蓝色边框让我感觉,这个不像一个 dashboard 界面,我觉得应该区分 dashboard 块以及真正的可以聊天变更内容的块;几个 0,显得很突兀"
- **现象与根因(两条)**:
  1. **蓝色描边是 bug 级误激活**:`presentation-surface-host.tsx` 的 `active: requestedFocuses.length > 0 ? concern.startsWith('presentation:')` 把**所有** presentation surface 恒标激活,`border-primary ring-2` 于是常驻——而该高亮本设计只服务 `?concern=` 聊天回执锚点(S5)。修法:`active: concernParam !== undefined && concern === activeConcern`。
  2. **dashboard 块与写交互块无视觉分层**:在等我/在动/工作线投影区与动作表单区同为描边卡片,读面(看)与写面(动)无语言区分。方向:读面区降装饰(弱边框/统计卡语言),写交互保持按钮语言(T33 读多写少);属于 F-07 动作分层的镜像面。
  3. **0 计数突兀**(并入 F-06 扩展):空区块的大"0"没有信息量——空态应是一句引导("暂无进行中的委托")而非数字;计数只在 >0 且有成员时显示。
- **证据**: 浏览器现场 `/`。
- **处置**: 蓝描边修复归 D-2(一行);dashboard 分层归 E(与 F-07/F-11 同批);0 计数并入 F-06。


## F-25 "共同注视"概念漂移:导航承诺协议,页面交付的是文章列表(P1)

- **状态**: open
- **严重度**: P1(业务概念清晰度,用户质询:"共同注视这个界面,是什么意思?我发现它的意义现在变得不明确了")
- **发现**: 用户反馈(2026-08-28)
- **现象与根因**: vision §二里 canvas 的本义是**协议面**:"agent 导航 → canvas 落面 → clientView 回报"——合同是共读的书,canvas 是两人手指同时落下的那一行。但现在的 `/canvas`(无 focus)渲染的是**画布/文章集合列表**——名字承诺"共同注视",内容交付"文章列表",名实分离导致意义失焦。
- **重定位方向(F 轮,概念修正)**:
  1. 无 focus 时页面主位呈现**当前注视**(presence/URL 派生):有注视 → 直落该面("你们正在共同看:X");无注视 → 呈现入口层(应用/集合目录),而不是默认 articles——articles 只是可注视对象之一,不是 canvas 本身;
  2. 页题与导航一物一名:要么页面坐实"共同注视"的本义(注视即内容),要么导航改任务语;二选一,不允许名实继续分离;
  3. 与 F-23 应用入口区合并设计:无注视时的入口层 = 应用入口 + 集合目录(书架),有注视时的主位 = 共读内容。
- **证据**: `evidence/2026-08-27-initial-walkthrough/03_canvas.png`(题"画布"内容 articles)。
- **处置**: Phase F(与 F-23/E-2 合并设计);复验故事 S5/S1。

## F-26 入口区交互规则与一眼可读文案标准(用户设计指令)

- **状态**: open
- **严重度**: P1(设计约束,F-23 的实现边界)
- **发现**: 用户设计指令(2026-08-28):"如果增加 entry,那就要增加 pin,数量超过多少之后,默认收缩;之后即使有数字展示,我也希望整体文案我是一看就明白的"
- **指令落点**:
  1. **应用入口区(F-23)必须带 pin**:用户可钉住常用应用到前排;钉住态持久化优先复用既有用户级 sidecar/pin 机制(presentation 事件可回放),实现期定案,不新增第二真相;
  2. **数量阈值默认收缩**:入口超过阈值(建议 6)时默认折叠为"更多应用 ⌄",钉住的始终展开;
  3. **一眼可读文案标准(全站文案验收线)**:任何数字不得裸奔——必须"数词+名词+状态"(`3 件事在等你`,不是 `3`);区块标题自答"这是什么";该标准并入 F-06/F-24 的空态与计数收敛,作为 Phase D/E 文案验收的硬线。
- **证据**: 浏览器现场 `/`。
- **处置**: F-23/E-2 实现边界;文案标准并入 D-2/F-06;复验故事 S1。


## F-27 thread 动作无对象、无价值叙事:"挂载/卸载引用"不可理解(P0,用户核心反馈)

- **状态**: fixed-pending-recheck(话术/材料清单/对象选择器/清单内移出全部落地;选择器=关闭必要条件已达成,待 R3 复验)
- **严重度**: P0(用户原话:"你给我塞一个 thread 对象,我不知道干啥;填写挂载引用参数,卸载引用参数;莫名其妙的")
- **发现**: 用户反馈(2026-08-28)
- **现象与根因(四层)**:
  1. **目的缺席**:线页不显示目标(F-11),用户看不到"处理 webflux 批次 CVE"这件事本身,"挂载引用"就没有任何可以回答的"为什么";
  2. **动词是数据模型语**:attach/detach(挂载/卸载引用)是 ThreadSnapshot 上下文包的机制动词;用户的任务语是"把 spring-core 仓库加进这件事/这件事涉及哪些材料";
  3. **动作没有对象**:挂载表单要用户裸填一个 rel——没有可选对象清单(sitemap 集合本应是双方共用的发现面,§二 同一扇门),没有建议、没有浏览器;就算措辞完美,无对象可选拍照样不可用;
  4. **价值回路不可见**:挂引用的价值("挂上后助手做事知道涉及它;相关 run/批准/事件会归到这条线下")从未被呈现——引用挂上后 UI 无任何反馈说明它改变了什么。
- **修复方向(E-1 叙述页的具体化,合并 F-11/F-08)**:
  1. 目标句上标题下第一行(E-1 既有);引用区呈现为**材料清单**(读卡:对象业务名+来源 scope+挂入时间),不是动作按钮堆;
  2. 挂载/卸载改写为**清单上的操作**:"添加涉及对象"(点开即对象选择器,候选= sitemap 集合的成员,机械派生零特判)/清单项上的"移出本线";自由表单退位(选择门口径);
  3. 动作 title 走合同数据任务语(work-thread 定义数据,文案滑梯红线:改数据不改渲染器);
  4. 挂载成功后清单即时出现新条目 + 一句价值回显("助手在本线内工作时会看到它")。
- **用户裁决(2026-08-28)**: "我怎么添加,我要背下来对象的引用?"——裸填 rel 被否,**对象选择器从"修复方向"升级为 F-27 关闭的必要条件**(不做选择器不得关闭本条)。
- **选择器设计(具体化)**:
  1. **入口**: 材料组 [＋添加涉及对象] → 展开选择器面板(不是 RJSF 表单);**落点随 F-29④ §十定稿收敛为书桌工作集的一个"＋"**(书桌纯读轨上唯一的常显操作);
  2. **候选来源 = sitemap 集合成员**(§二 同一扇门:人与 agent 共用的发现面,机械派生):按集合分组列出(文章/待办/想法/评论…),每行 = 业务标题 + 集合徽章;顶部标题过滤框;
  3. **点击即挂**: 选中 → attach(category, rel);category 缺省 context(材料),四桶(context/active/approval/event)以语义化选择保留高级口径;挂载后清单当场入列(选择器内该项标记"已在本线");
  4. **反向外挂(二期)**: 任意对象面在线声明时提供"挂到当前线"——合法路径 = 预填跳转(导航至线工作台并预填 attach)或 chat 一句话("把这篇挂到线上",引用可解);
  5. **chat 正典不变**: "把 post:first-post 挂到 helloworld 线"——引用可解,助手执行 attach。
- **证据**: `evidence/2026-08-27-initial-walkthrough/27_thread_focus.png`。
- **处置**: 并入 Phase E-1(叙述页 + 材料清单 + 选择器);复验故事 S8(预期同步强化)。
- **修复记录(2026-08-28,commit 397144a)**: 线投影声明任务语字段(状态"进行中"/上次停在哪/目标来源);context 投影为可导航成员卡(身份解析自被引对象);动作 title 任务语化(添加/移出涉及对象,合同数据层);rel 字段补说明。**已知残项**: resume 回退分支仍用节点名(P2);对象选择器与清单内一键移出归 W 阶段。
- **二轮修复(2026-08-28,F-29④ 同批)**: ①**引擎真实缺陷修复**——context 成员身份回退机器 rel 的根因是 store fields 为带 origin 的 FieldValue 包装,`referenceIdentity` 按裸字符串判型失配;改经 `fieldValues` 解包(identity 优先,title 次之),回归测试入 work-thread.test.ts;线上复验身份=「完成 T35 全轨道验收」。②resume 回退线程状态改任务语(停在「进行中」);节点名标题化(statusPointer 携带节点 title)仍为残项。③**对象选择器落地**(书桌工作集「＋」):候选=sitemap 集合面成员按集合分组(业务标题+状态+标题过滤),点击即挂 category=context,已在本线禁选标注;裸填 rel 表单退位(动作仍可达,表单 description 指引选择器)——**本条关闭条件达成,待 R3 复验后关闭**。


## F-28 I5 重放一致(application 维度)在 bundle 扩容后 online/replay 不一致(WIP)

- **状态**: rechecked(2026-08-28 关闭)
- **严重度**: P1(测试基建/引擎一致性信号)
- **发现**: 2026-08-28,S9/S10 bundle 扩容后的 db 全量回归
- **现象**: `service.definitions.test.ts` 的 I5 重放一致(application 维度):重放轨道(TRUNCATE+原序回灌+生产 boot)的 applications 表 8 个(含 todo/ideas,正确),在线轨道(boot+增量维护)的同表只有 6 个(缺 todo/ideas)。同文件其余 24 测试全过;单独运行该文件亦复现(非跨测试污染)。
- **已做迁移**: 该文件 6 处闭式清单(定义 seed rel×2/应用 seed rel×2/前缀 26 帧/keys)已按 10 定义/8 应用迁移。
- **根因假设(未证实)**: 在线轨道的单例状态构建与 bootstrap 追加的时序交互——boot() 先建引擎状态后补种(或复用前一测试的单例),增量 fold 未覆盖 application-seeded 的 delta;与"bundle 版本门控的部分补种"叠加。需要专项定位 bootEngine 状态构建与 bootstrap 的先后。
- **处置**: 挂账专项(引擎测试基建);不影响已验收的产品面(dev 现场实证 todo/ideas 播种/可达/闭环)。修复后回填本条并复跑 db 全量。
- **修复记录(2026-08-28)**: 根因=测试侧期望锚与种子源脱节——`businessApplicationList` 只是 walkthrough 夹具(6),而 bootstrap 播种用 `installedApplicationBundles`(8);且安装序为逐 bundle 完整安装(各自带 seed/applied 收据)。修复=反空转锚改与种子同源 + 该测试 6 处闭式清单按 10 定义/8 应用/逐 bundle 序迁移。**结论:引擎在线/重放一致性无缺陷,纯测试期望脱节。** 全量 3078 通过 0 失败。


## F-29 线工作台三栏:重复/溢出/自动停靠 + 三原则缺位(W 阶段自查,浏览器实测)

- **状态**: fixed-pending-recheck(§十 结构性修复已落地并浏览器实测;待 R3 按故事 S8 复验)
- **严重度**: P1
- **发现**: 2026-08-28,W1 上线后现场检视;用户追问"对齐/对比/亲密性体现在哪里"并裁决"必须要调整信息组织格式"
- **用户二轮追问(2026-08-28,设计定稿触发)**: "为什么是三栏,为什么不是横着一栏,纵向两栏?pIN 是要 PIN 住在上下文里面,还是 pin 住实时展示?""把聊天框也塞进来,不是四栏?界面设计就有问题""有些东西改动没有那么频繁,为什么按钮都展示出来?"——三问共同指向:W1 缺**扩张不变式**与**常显/操作分层**,且 W2 把 pin 做成了"左栏实时渲染整面",正是②塞爆的结构性根因。
- **现象**: ① URL focus=thread:X 时,**左轨与中栏渲染同一张线面**——同一叙述并排两份(重复+占地);② 左轨 w-80 内容溢出:钉住的 todos 卡与动作按钮相互压叠、按钮文字被截断;③ chat 进线后仍为悬浮 FAB,未自动停靠为右栏;④ **三原则缺位**(对齐:三栏顶边无基线、按钮溢出右缘;对比:标题/状态/图例/按钮同档无层级、五种动作无主次、左右栏角色差不可感知;亲密性:图例隔开相关内容、添加按钮脱离材料清单、三组语义不同的动作等距挤一列、钉住卡无归属感)。
- **修复**: ①✅focus 即本线时中栏改协作引导,不重复渲染线面;②✅结构性根治(原 overflow 修补为临时止血):左轨改为**书桌目录**(thread-desk,纯读),不再渲染整面 surface——塞爆被信息组织消灭;③✅chat 在 thread 声明页打开即停靠分栏(open 联动,F-22 top-12/dvh);④✅**§十 定稿全部落地(2026-08-28,commit 见 fix t35 F-29④)**:
  - pin=上下文引用:钉住进书桌工作集条目(标题+状态 chip+点击唤起注视+hover 移出/取消钉住),整面渲染废除;
  - 布局不变式 2 轨 + 1 舞台:书桌(纯读目录)/注视(唯一舞台)/助手(chat 分栏);
  - 按钮跟着注视走:书桌仅「＋添加涉及对象」一个常显操作;线的生命周期动作(暂停/完成/归档)呈现在舞台 ThreadStageActions(attach/detach 由书桌供项覆盖,不重复渲染表单形态;D47.4 不破,同一合同动作仍可达);
  - 动作危险分层(通用):ActionGroup 按合同 requires-confirmation 派生危险组(dashed 分隔+danger 描边),归档与推进操作不再同级——F-07 一并落地;
  - 三栏顶边基线与叙述卡排版(§九 现状组:目标 H1 最重/状态 chip/停在哪/来源弱化)。
- **复验记录(2026-08-28,浏览器实测)**: 书桌渲染/选择器四集合分组(articles/todos/ideas/评论,业务标题+状态+已在本线禁选)/点击即挂(context)/条目点击唤起注视/去重(钉住+context 单条目)/hover 移出走合同 detach/舞台暂停→书桌状态 chip 即时翻转为已暂停/恢复;截图 `evidence/2026-08-28-desk/`(desk-initial/desk-selector/gaze-with-pin)。组件测试 6 项 + 组件套件 268 项全绿。**状态: fixed-pending-recheck(待 R3 按故事 S8 全量复验)**
- **证据**: 浏览器现场截图(本轮);`evidence/2026-08-28-W/`。

## F-30 工作线归档无确认门(P2)

- **状态**: fixed-pending-recheck
- **严重度**: P2
- **发现**: 2026-08-28,W1 现场检视
- **现象**: post 归档走 high-risk 确认门(挂起→在等我批准),而**工作线归档一键直达**——线聚合了目标/材料/进行中工作,不可逆性与 post 同级甚至更高,却无确认门。
- **修复**: work-thread 定义 archive 动作补 requires-confirmation: high(合同数据层,与 post 归档同规)。
- **修复记录(2026-08-28,commit d9e7ea8)**: `THREAD_ARCHIVE_ACTION` 补 `'requires-confirmation': 'high'`;2580 测试通过。浏览器复验归 Phase F(归档 → 两段式确认门)。

---

## 复验记录(回填区)

(暂无;每条 fixed-pending-recheck 的问题按 user-stories.md 对应故事复验后,在此回填日期、故事号、截图路径与结论。)
