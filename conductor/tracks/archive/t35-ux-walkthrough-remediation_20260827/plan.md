# T35 持续试用与走查修复 — Plan

> **状态: 完成(2026-08-28 收口)**。R1–R3 三轮走查,S1–S11 全部故事通过;findings 全量对账(27 rechecked + F-20 wontfix + F-05/F-26 方向项 open);门禁全绿。收口提交链见 git log(fix/feat(t35) 系列 + `chore(t35): R3 收口`)。勾选依据=提交链+走查截图证据,个别子项偏差就地注记。

> 执行遵循 `conductor/workflow.md`(TDD 红绿、自治编排协议、治理门禁)。
> **验收特例**(spec 验收协议):每个 Phase 的收口任务不是跑单测,而是按
> [`user-stories.md`](./user-stories.md) 做文档化视觉走查(浏览器实测 + 截图入
> `evidence/` + `findings.md` 回填);单测只是语义回归护栏。
> 文案/术语类修复的合法路径 = 改合同/定义数据与投影;渲染器禁止新增文案模板。

## Phase A 动作回执与 surface 失效(修 F-01;故事 S2/S3/S4)

- [x] Task: A1 红灯——语义回归测试先行
  - [x] 在 `apps/web/src/engine/presentation`(runtime/broker 层)补测试:exec 成功事件后,受影响 subject 的用户 sidecar 必须失效(同键再取不得返回旧版本)
  - [x] 在 `apps/web/src/components/actions/action-group.tsx` 相关测试补:动作提交后存在 pending 态与结果回执呈现通道(结构化,零文案模板)
  - [x] `pnpm vitest run` 相关文件确认红灯
- [x] Task: A2 实现——exec → sidecar 失效/重算链路(定位 `apps/web/src/engine/presentation/runtime.ts`、`apps/web/src/db/presentation.ts`、exec 路由 service 钩子;不新增处境装配点)
- [x] Task: A3 实现——动作控件 pending/回执呈现(投影更新为硬要求;回执走合同插值,不加 toast 文案库)
- [x] Task: A4 排查首页双"创建工作线"按钮重复渲染(F-15)
- [x] Task: A5 回归——`pnpm vitest run --project unit` + `pnpm governance` 全绿
- [x] Task: A6 Phase 视觉验收 & Checkpoint:按 user-stories.md 走 S2/S3/S4,截图入 `evidence/<date>-S2|S3|S4/`,findings 回填 F-01/F-15 复验记录
- [x] Task: A7 提交 `fix(t35): exec 后 surface 失效与动作回执(F-01,F-15)`

## Phase B 跨面链接与无效注视(修 F-02;故事 S5)

- [x] Task: B1 红灯——`apps/web/src/presence/navigation.ts` 链接投影测试:"查看活实例"必须指向实例集合(存在性由集合 rel 决定),不得以 flow 定义 rel 作 focus
- [x] Task: B2 实现——修正链接目标生成(flow → 活实例集合视图)
- [x] Task: B3 红灯——canvas focus 解析失败测试:结构化空态(目标不存在 + 恢复入口),且不得把无效 focus 写入会话上下文(presence/chat clientView 侧)
- [x] Task: B4 实现——无效 focus 结构化空态与上下文隔离(与 D51 缺失语义一致)
- [x] Task: B5 回归——`pnpm vitest run --project unit` + `pnpm governance` 全绿
- [x] Task: B6 Phase 视觉验收 & Checkpoint:S5 走查,截图,findings 回填 F-02
- [x] Task: B7 提交 `fix(t35): 活实例链接与无效注视结构化空态(F-02)`

## Phase C 人机同门:向导渲染、错误聚合、代理收敛(修 F-03/F-04;故事 S6)

- [x] Task: C1 红灯——`apps/web/src/render/presentation/generic.ts` + deref 链路测试:article-drafting 新实例状态下 subject 词元绑定不得解析为 undefined(空态有合法回退值)
- [x] Task: C2 实现——修复 deref 根因(空实例/新实例绑定回退)
- [x] Task: C3 红灯——`presentation-surface-host` 诊断聚合测试:同 surface 同类诊断渲染为一条可展开项
- [x] Task: C4 实现——诊断聚合呈现(错误行 ≤1 + 展开详情)
- [x] Task: C5 实现——代理收敛:助手每步消费可靠进度事实(自身 exec 回执 + 实体投影),目标达成即停(`apps/web/src/chat/`、`packages/agent` 相应模块)
- [x] Task: C6 红灯→实现——会话/turn 成败标注与业务结果一致(`apps/web/src/chat/conversation.ts` 投影)
- [x] Task: C7 回归——`pnpm vitest run --project unit` + `pnpm governance` 全绿
- [x] Task: C8 Phase 视觉验收 & Checkpoint:S6 走查(真实 LLM 配置),截图,findings 回填 F-03/F-04
- [x] Task: C9 提交 `fix(t35): 向导面韧性、诊断聚合与代理收敛(F-03,F-04)`

## Phase D 术语与文案收敛(修 F-05/06/08/09/10/12/13/16;故事 S1/S7)

- [x] Task: D1 落统一术语表(写入本 track `findings.md` 附录或 `docs/`),数据层改名:应用/流程定义 title、sitemap 集合标题中文化一物一名(改 `apps/web/src/applications/`、`apps/web/src/domain/` 定义数据,零渲染器特判)
- [x] Task: D2 通用渲染机修 F-06:删双计数、self 空卡、重复样板句(`generic.ts`/组合层;动作保留合 D47.4)
- [x] Task: D3 动作文案:action title 数据回归动作语("新建工作线"式),替代"填写XX参数"框架显示;创建表单必填项补合同携带的提示数据(F-08)
- [x] Task: D4 聊天面:澄清语走 LLM 人话、证据 chip 结构化可点、JSON path 进可展开审计层;聊天底栏"当前查看"人话化(F-09)
- [x] Task: D5 守卫原因:引擎原因结构化(数据),呈现层合同插值/LLM 转述,不硬编码模板(F-10)
- [x] Task: D6 顺带修 F-13/F-16/F-18/F-19:刷新动词统一、开发注释改使用者视角或入抽屉;导航当前项指示(aria-current+视觉层级,F-18);系统下拉受控弹出层并在导航后收起(F-13/F-19)
- [x] Task: D7 处境条芯片化重做(F-12 升级,方案已获用户认可):先落 F-21 业务标题,再常显收敛为"你在哪"状态芯片;三个补丁(chip 截断规则/桥接迁内容上下文/注视 chip 免交互可见+同门提示);声明字段与调整收进弹层
- [x] Task: D8 分栏聊天粘性视口列(F-22):aside sticky + dvh 高度,消息区内部滚动、输入框常驻屏内;与 D7 顶栏高度联动;浏览器长页面验收
- [x] Task: D9 回归——`pnpm vitest run --project unit` + `pnpm governance` + `pnpm format:check` 全绿
- [x] Task: D10 Phase 视觉验收 & Checkpoint:S1/S7/S9 走查(含顶栏/分栏新形态),截图,findings 回填
- [x] Task: D11 提交 `fix(t35): 术语统一与文案收敛(F-05..F-22 相关)`

## Phase E 工作线投影与动作层级(修 F-07/F-11;故事 S8)

- [x] Task: E0 蓝描边误激活修复(F-24 一部分):active 仅在 ?concern= 匹配时为真;首页/画布回归截图
- [x] Task: E-2 应用入口区(F-23+F-26):my-work 聚合声明升级,首页从 sitemap applications 派生应用入口区(标题+intent→entry surface);带 pin(复用用户级 pin 机制,实现期定案)与数量阈值默认收缩(>6 折叠"更多应用");文案按"数词+名词+状态"一眼可读标准,零特判;与工作线叙述页同批验收(S9/S10 可达性)
  - 注:阈值收缩与文案标准已落地并实测;**应用条 pin 未做**(F-26① 保留 open 方向项,不阻塞本 track——书桌工作集 pin 已按同一机制先落)
- [x] Task: E-3 canvas 重定位(F-25):无 focus 时主位呈现当前注视(presence/URL 派生),无注视呈现入口层;页题/导航一物一名;与 S5 合并验收
- [x] Task: E2 实现——工作线详情投影补全(`apps/web/src/engine` 投影 + 定义数据)
- [x] Task: E3 实现——动作分组与危险/常规视觉分层(通用 actions 区,零实体特判)
- [x] Task: E4 回归——`pnpm vitest run --project unit` + `pnpm governance` 全绿
- [x] Task: E5 Phase 视觉验收 & Checkpoint:S8 走查,截图,findings 回填 F-07/F-11
- [x] Task: E6 提交 `feat(t35): 工作线详情投影与动作层级(F-07,F-11)`

## Phase W 线工作台三栏(用户裁决并入本 track;design-notes §六)

- [x] Task: W1 线工作台布局:URL 声明 thread 且注视为线相关面时,工作台切三栏——
  左线叙述轨(消费 E-1 投影,pin 常驻)/中注视面(跟 situation)/右 chat(分栏态,
  联动 D-8);组合驱动零每实体特判(舞台机械判定:换应用不改码)
- [x] Task: W2 线内 pin 页面:surface 角落 📌 钉住/取消;钉住集 localStorage 按
  线隔离(与 ui4a.chat.mode 同规, presentation 偏好非真相);钉住面以 roots 网格
  常驻;显式 URL roots 优先
- [x] Task: W3 切线路径二:处境线芯片点开列我的线(threads 投影),选择即切;
  依赖 D-7;书桌正典(我的事)与 URL 显式已在
- [x] Task: W4 inline/委托提交语义话术(F-08③):提交控件旁一句说明
  ("发送=在线协同,页面可切;委托=交后台无人值守,进'在动'")
- [x] Task: W5 回归 + 浏览器验收(S6/S8 扩展:三栏内完成一次线内协作),截图入 evidence
- [x] Task: W6 提交 `feat(t35): 线工作台三栏与 pin/切线(F-27,F-23 关联)`

## Phase F 轮次收口与持续试用

- [x] Task: F1 R2 全站试用一轮(重复 R1 路径 + S1–S8 全量),新发现追加 `findings.md`(F-17+)
- [x] Task: F2 `pnpm check` 全绿;`CI=true pnpm e2e invariants` 通过
- [x] Task: F3 findings 状态对账(全部 fixed 项复验记录齐备或显式 wontfix 理由)
- [x] Task: F4 阶段收口 commit;轨道保持 `[~]`,视试用结果决定下一轮次(R3+)或进入收尾评审
