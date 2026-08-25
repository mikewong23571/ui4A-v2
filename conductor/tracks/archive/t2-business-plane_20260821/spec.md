# T2 业务平面基线 — Spec

> Track ID: `t2-business-plane_20260821` · Type: Feature · 状态: approved(编排 agent 代行验收)
> 上下文:`conductor/refs/arch-brief.md`(§2 合同层、§3 引擎裁决、§4 事件溯源、§5 B 场景、§6 driver、§7 :form、§8 聊天三投影)。

## Overview

从零实现业务平面:单引擎(三层裁决)+ append-only 事件日志 + Siren 投影 + HTTP 合同 + 种子业务域 + 双 driver(规则/LLM)agent 循环 + 悬浮聊天 + RJSF 哑表单人类路径。**T2 结束时 B1–B4 全部自动化通过(agent 走 HTTP 合同、人类走 renderer 两遍),I1(B1–B3 范围)、I5、I6 成立。**

架构口径(铁律):引擎单 atom 串行提交;三层裁决顺序不可换(声明→guard→schema);拒绝入日志带原因(I6);应用核心是日志的纯函数,重放一致性有测试(I5);guard 纯且只读快照;agent 与人类走同一合同同一日志。

## 架构决定(本 track 内有效)

1. **新包 `packages/engine`(@ui4a/engine)**:machine-as-JSON 类型、三层裁决、引擎、Siren 投影(rel→entity)、sitemap 推导。纯 TS,零 Node API 依赖,可被 web/worker 共用。
2. **guard 谓词放 `packages/shared`**(按钮 disabled 与 agent guard-results 是同一谓词两投影);engine 通过谓词注册表(名字→函数)求值。
3. **流程定义 T2 阶段为代码内 TS 常量**(machine-as-JSON);T4 才挪进事件日志。实例状态由事件投影得出;转移合法性用 XState v5 `createMachine(config)` 运行时构造校验。
4. **agent 循环 = HTTP 客户端循环**(fetch 本源 `/api/*`):聊天路由在服务端跑循环、E2E 测试直接跑同一循环——"agent 走合同"字面成立,测试无需浏览器。
5. **种子业务域**(满足 B1–B3):
   - flow `article-drafting`(三步向导):`basic-info`(fields: title)→ `classification`(fields: category[select: tech/essay/review], tags)→ `content`(fields: body)→ `ready`(action `publish`,effect: transition + append 新文章实体);
   - flow `post-status`:`published → offline`(unpublish)、`published → archived`(archive,T3 才挂确认);
   - flow `comment-moderation`:`pending → approved | rejected`(approve/reject,guards: is-pending);
   - 资源:`articles` 集合 rel(sub-entities 直达 `post:<id>`);`comments` 集合;
   - 种子数据:2 篇已发布文章(含 `post-welcome`)、3 条 pending 评论 + 1 条 approved。
6. **LLM driver**:GLM Chat Completion 端点(`https://open.bigmodel.cn/api/coding/paas/v4`,见 `tech-stack.md` LLM 节),AI SDK `createOpenAI({baseURL,apiKey})`;key 经 env `GLM_API_KEY`(本地 `.env.local`,来源 `/Users/mike/.secrets/glm_coding_plan_key`,严禁入 git);无 key 自动回退 rule driver(I1)。
7. **E2E 分层**:默认 E2E 全走 rule driver(确定性、零成本);真实 LLM 冒烟测试仅在 `RUN_LLM_E2E=1` 时执行。B4 用注入坏 key 驱动(无需真实网络)。

## Functional Requirements

1. **引擎(@ui4a/engine)**:machine-as-JSON 类型与解析;exec(request: rel/action/params/actor/principal/channel)三层裁决:①action 声明于当前节点②guard 谓词求值③字段 schema(Ajv,JSON Schema draft-07);拒绝→带原因事件入日志(不生效);通过→效果应用。效果词汇表(T2 子集):`transition`、`set-field`、`append`(集合追加实例)、`spawn`(stub:记录事件,T3 接 Temporal)。串行单写。
2. **事件日志(PG)**:`events` 表 append-only(id 单调、ts、actor、principal、channel、kind: action-executed | action-rejected | entity-appended | …、rel、action、params 出处 default/intent/proposal/elicited、reason);每事件递增 seq;**拒绝事件与执行事件同表**(I6);投影=fold(日志);`/api/events` 只读端点(审计视图原始输出,T7 才做 timeline 渲染)。
3. **Siren 投影**:rel→实体(properties/actions/links/guard-results);action 含 name/title/method/href/fields(schema);集合实体带 `entities[]` 子实体;links 含 self 与导航 rel(含子实体直达);guard-results 逐项注入(通过/拒绝+原因)。
4. **HTTP 合同**:`/.well-known/ui4a.json`(sitemap:界面清单、flows 拓扑、每节点 action schema、版本号)、`/api/entity?rel=…`、`/api/exec`(POST)、`/api/events`;exec 响应:通过→新实体或 204+结果;拒绝→4xx + 结构化原因(与日志一致)。
5. **rule driver + agent 循环**:循环 = navigate/exec/done 三操作 + 目标相关性决策次序(点名资源 > 点名动作 > 相关节点推进 > 自由漫游,每层停止条件);done 判定 = "完成类动作成功过"(相对目标);拒绝即数据(记录、换路径或字段自救)。
6. **LLM driver**:同一循环协议,决策由 LLM 产出(OpenAI 兼容 tool calling:固定动词 5 个 navigate/exec/clarify/render/done + 当前实体动态动作工具,guard 结果嵌 description);坏 key/网络错误如实进入对话(委托不崩溃)。
7. **悬浮聊天**:右下角悬浮窗,展开为会话;输入目标→agent 轨迹逐步呈现(导航/执行/拒绝原因/完成);组件用 assistant-ui + AI SDK(选型既定;若集成受阻,记 DECISIONS 偏差后降级为 @ai-sdk/react useChat 自绘面板)。
8. **:form runner 人类路径**:最小 renderer——实体页(actions 渲染为 RJSF 表单/按钮,guard-results 驱动 disabled)+ 文章列表/评论队列入口页;人类可完成 B1–B3 同款场景(同一日志,actor=human)。

## Acceptance Criteria

1. `CI=true pnpm check` 全绿(engine/shared 单测 + 合同级测试);
2. **E2E(agent 走合同,rule driver)**:B1(发布→文章计数 2→3)、B2(子实体链接直达 post-welcome→unpublish→仅该篇 offline)、B3(approve 至 pending=0,留痕)、B4(坏 key→401 进对话、循环存活);
3. **E2E(人类走 renderer,Playwright UI)**:B1(三步表单+发布按钮)、B2(列表进入文章→下线按钮)、B3(队列逐条 approve)全通过;事件日志含 actor=human 记录;
4. **I1**:E2E 环境不设 GLM_API_KEY,B1–B3(agent 路径)与人类路径仍全过(rule driver + 表单);
5. **I5**:测试——跑完 B1–B3 后取实体状态 hash;清库重放事件日志;hash 一致;
6. **I6**:测试——每个被拒 exec 在 `/api/events` 可见带 reason,且下一步 agent 决策上下文可读取该原因;
7. 悬浮聊天在人类路径页面可用,agent 轨迹可见;
8. `RUN_LLM_E2E=1` 时 B1 走 LLM driver 冒烟通过(真实 GLM 调用,编排者验收时手动跑一次)。

## Out of Scope(非目标)

- Cedar/Keycloak/确认门/pending 实体/notify/收件箱(T3);requires-confirmation 字段可先存在于 schema 但不生效;
- `_meta` 平面、machine 入事件日志、机械 diff、BIOS(T4);
- Temporal 实际接入与 worker 改造(T3/T5;spawn 效果只记录事件);
- plan-exec(T6);渲染词汇表/A2UI/图表/画布/态势主页(T7,T2 的 UI 只有表单/列表/聊天,样式极简);
- Cedar 策略裁决层(T3 加入,裁决顺序届时扩展);
- MCP server 投影(后续独立任务);
- 部署/CI 平台。
