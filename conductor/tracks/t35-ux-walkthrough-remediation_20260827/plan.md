# T35 持续试用与走查修复 — Plan

> 执行遵循 `conductor/workflow.md`(TDD 红绿、自治编排协议、治理门禁)。
> **验收特例**(spec 验收协议):每个 Phase 的收口任务不是跑单测,而是按
> [`user-stories.md`](./user-stories.md) 做文档化视觉走查(浏览器实测 + 截图入
> `evidence/` + `findings.md` 回填);单测只是语义回归护栏。
> 文案/术语类修复的合法路径 = 改合同/定义数据与投影;渲染器禁止新增文案模板。

## Phase A 动作回执与 surface 失效(修 F-01;故事 S2/S3/S4)

- [ ] Task: A1 红灯——语义回归测试先行
  - [ ] 在 `apps/web/src/engine/presentation`(runtime/broker 层)补测试:exec 成功事件后,受影响 subject 的用户 sidecar 必须失效(同键再取不得返回旧版本)
  - [ ] 在 `apps/web/src/components/actions/action-group.tsx` 相关测试补:动作提交后存在 pending 态与结果回执呈现通道(结构化,零文案模板)
  - [ ] `pnpm vitest run` 相关文件确认红灯
- [ ] Task: A2 实现——exec → sidecar 失效/重算链路(定位 `apps/web/src/engine/presentation/runtime.ts`、`apps/web/src/db/presentation.ts`、exec 路由 service 钩子;不新增处境装配点)
- [ ] Task: A3 实现——动作控件 pending/回执呈现(投影更新为硬要求;回执走合同插值,不加 toast 文案库)
- [ ] Task: A4 排查首页双"创建工作线"按钮重复渲染(F-15)
- [ ] Task: A5 回归——`pnpm vitest run --project unit` + `pnpm governance` 全绿
- [ ] Task: A6 Phase 视觉验收 & Checkpoint:按 user-stories.md 走 S2/S3/S4,截图入 `evidence/<date>-S2|S3|S4/`,findings 回填 F-01/F-15 复验记录
- [ ] Task: A7 提交 `fix(t35): exec 后 surface 失效与动作回执(F-01,F-15)`

## Phase B 跨面链接与无效注视(修 F-02;故事 S5)

- [ ] Task: B1 红灯——`apps/web/src/presence/navigation.ts` 链接投影测试:"查看活实例"必须指向实例集合(存在性由集合 rel 决定),不得以 flow 定义 rel 作 focus
- [ ] Task: B2 实现——修正链接目标生成(flow → 活实例集合视图)
- [ ] Task: B3 红灯——canvas focus 解析失败测试:结构化空态(目标不存在 + 恢复入口),且不得把无效 focus 写入会话上下文(presence/chat clientView 侧)
- [ ] Task: B4 实现——无效 focus 结构化空态与上下文隔离(与 D51 缺失语义一致)
- [ ] Task: B5 回归——`pnpm vitest run --project unit` + `pnpm governance` 全绿
- [ ] Task: B6 Phase 视觉验收 & Checkpoint:S5 走查,截图,findings 回填 F-02
- [ ] Task: B7 提交 `fix(t35): 活实例链接与无效注视结构化空态(F-02)`

## Phase C 人机同门:向导渲染、错误聚合、代理收敛(修 F-03/F-04;故事 S6)

- [ ] Task: C1 红灯——`apps/web/src/render/presentation/generic.ts` + deref 链路测试:article-drafting 新实例状态下 subject 词元绑定不得解析为 undefined(空态有合法回退值)
- [ ] Task: C2 实现——修复 deref 根因(空实例/新实例绑定回退)
- [ ] Task: C3 红灯——`presentation-surface-host` 诊断聚合测试:同 surface 同类诊断渲染为一条可展开项
- [ ] Task: C4 实现——诊断聚合呈现(错误行 ≤1 + 展开详情)
- [ ] Task: C5 实现——代理收敛:助手每步消费可靠进度事实(自身 exec 回执 + 实体投影),目标达成即停(`apps/web/src/chat/`、`packages/agent` 相应模块)
- [ ] Task: C6 红灯→实现——会话/turn 成败标注与业务结果一致(`apps/web/src/chat/conversation.ts` 投影)
- [ ] Task: C7 回归——`pnpm vitest run --project unit` + `pnpm governance` 全绿
- [ ] Task: C8 Phase 视觉验收 & Checkpoint:S6 走查(真实 LLM 配置),截图,findings 回填 F-03/F-04
- [ ] Task: C9 提交 `fix(t35): 向导面韧性、诊断聚合与代理收敛(F-03,F-04)`

## Phase D 术语与文案收敛(修 F-05/06/08/09/10/12/13/16;故事 S1/S7)

- [ ] Task: D1 落统一术语表(写入本 track `findings.md` 附录或 `docs/`),数据层改名:应用/流程定义 title、sitemap 集合标题中文化一物一名(改 `apps/web/src/applications/`、`apps/web/src/domain/` 定义数据,零渲染器特判)
- [ ] Task: D2 通用渲染机修 F-06:删双计数、self 空卡、重复样板句(`generic.ts`/组合层;动作保留合 D47.4)
- [ ] Task: D3 动作文案:action title 数据回归动作语("新建工作线"式),替代"填写XX参数"框架显示;创建表单必填项补合同携带的提示数据(F-08)
- [ ] Task: D4 聊天面:澄清语走 LLM 人话、证据 chip 结构化可点、JSON path 进可展开审计层;聊天底栏"当前查看"人话化(F-09)
- [ ] Task: D5 守卫原因:引擎原因结构化(数据),呈现层合同插值/LLM 转述,不硬编码模板(F-10)
- [ ] Task: D6 顺带修 F-12/F-13/F-16:处境条文案与合法值提示、下拉点击后收起、刷新动词统一、开发注释改使用者视角或入抽屉
- [ ] Task: D7 回归——`pnpm vitest run --project unit` + `pnpm governance` + `pnpm format:check` 全绿
- [ ] Task: D8 Phase 视觉验收 & Checkpoint:S1/S7 走查,截图,findings 回填
- [ ] Task: D9 提交 `fix(t35): 术语统一与文案收敛(F-05..F-16 相关)`

## Phase E 工作线投影与动作层级(修 F-07/F-11;故事 S8)

- [ ] Task: E1 红灯——工作线详情 surface 投影测试:identity 用业务标题;goal/status/引用/近期事件字段以 presentation.fields 角色声明进入 surface(消费 T26 既有投影)
- [ ] Task: E2 实现——工作线详情投影补全(`apps/web/src/engine` 投影 + 定义数据)
- [ ] Task: E3 实现——动作分组与危险/常规视觉分层(通用 actions 区,零实体特判)
- [ ] Task: E4 回归——`pnpm vitest run --project unit` + `pnpm governance` 全绿
- [ ] Task: E5 Phase 视觉验收 & Checkpoint:S8 走查,截图,findings 回填 F-07/F-11
- [ ] Task: E6 提交 `feat(t35): 工作线详情投影与动作层级(F-07,F-11)`

## Phase F 轮次收口与持续试用

- [ ] Task: F1 R2 全站试用一轮(重复 R1 路径 + S1–S8 全量),新发现追加 `findings.md`(F-17+)
- [ ] Task: F2 `pnpm check` 全绿;`CI=true pnpm e2e invariants` 通过
- [ ] Task: F3 findings 状态对账(全部 fixed 项复验记录齐备或显式 wontfix 理由)
- [ ] Task: F4 阶段收口 commit;轨道保持 `[~]`,视试用结果决定下一轮次(R3+)或进入收尾评审
