# T48 Application Genesis 产品内闭环与 Meta 人机同门 — Plan

> 执行纪律:严格 TDD(先红后绿);每任务完成即 commit + git note;Phase 结束跑
> Phase Checkpoint(workflow.md;审批点由编排 agent 按自治协议代行,验证证据记入
> git notes)。GR1–GR5 全程生效;GR3 红线现状:views.ts 483/500、execute.ts 434/500、
> drafts.test.ts 714/800——涉及文件变更时必须沿功能边界拆解,新测试放独立文件。
> 前置:工作区有未提交的 D65(CLI --scope)改动,Phase 0 开始前先核对并单独提交。

## Phase 0 — 决定与文档先行(先记录,再动代码)

- [x] Task: 提交遗留 D65 工作区改动并核对门禁 [b20982c]
- [x] Task: DECISIONS.md 落盘 D66/D67(spec §3 全文:载体/锚定/激活语义/授权推导补充/同门与文档修订) [e6af748]
- [x] Task: GOAL.md「App 创建边界」改写 + conductor/index.md 禁止复活清单修订 + T39 北极星修订注记(D67 记录,归档按 GR5 只读) [3de6142]
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 3de6142]

## Phase 1 — 合同层:application-bundle Draft kind

- [x] Task: packages/shared + packages/db — kind 联合与 Draft 存储面扩展(测试先行) [a27c83]（shared 已含该值,db kind 无关;新增 lifecycle/重放幂等测试直接绿）
- [x] Task: apps/web engine/drafts/views.ts — create 动作与投影扩展 [13b4b8]
- [x] Task: apps/web engine/drafts/create.ts — application-bundle 校验与冲突 guard [13b4b8]
- [x] Task: revise/validate/diff 路径覆盖 application-bundle [13b4b8]（GR3 拆解 application-bundle.ts;engine 纯校验器 validateApplicationBundleDraft）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 13b4b8]（自治验收:20/20 复跑绿+governance OK;改动文件均有对应测试）

## Phase 2 — 激活事务:人类 approve → 原子 seed 事件

- [x] Task: packages/db — 多事件原子激活计划(测试先行) [75247a0]（AtomicCoreMutationPlan 数组合同统一,GR2 消除单/双形态;回滚/重试覆盖）
- [x] Task: apps/web engine/drafts — application-bundle 激活分支(execute.ts 沿功能边界拆出 activate-application/flow/agent) [75247a0]（449→352 行;锁内重验+planMetaBootstrap 原子落库;I4/竞态 stale 留痕）
- [x] Task: 重放与完整性 [75247a0]（applications/sitemap 生长;assertMetaBootstrapIntegrity;receipt 幂等重跑空;I5 全 log 重放一致）
- [x] Task: Phase Verification & Checkpoint (Refer to workflow.md) [checkpoint: 75247a0]（自治验收 27+4 绿;补救:definition/ GR3 超限→definition/bundle/ 子目录 [31d78f8]）

## Phase 3 — 授权推导:治理角色展开(D66.4)

- [ ] Task: apps/web auth/request-identity.ts — credential 授予集合治理展开
  - [ ] 红测:授予含 governance → grantedApplications = 授予 ∪ 已安装全集;不含则原样;agent token 语义不变;展开不影响 ?scope= 丢弃规则
  - [ ] 绿:实现(展开发生在 authorizedPolicyScopes 已知之后)
- [ ] Task: meta exec/entity credential 合同测试扩展
  - [ ] 红测:治理凭证对新出生 app 的 entity/exec 可达;非治理凭证结构化 denied 留痕;US4 证据
  - [ ] 绿:实现/修测
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 4 — flow-definition genesis(D67.3)

- [ ] Task: create.ts — target 不存在时允许新 flow 提案
  - [ ] 红测:lens scope 内新 flow 名合法、payload.app == lens → Draft 建立;跨 lens/非法名拒绝留痕
  - [ ] 绿:实现
- [ ] Task: 激活分支 — 新 flow 的 definition-seeded v1 事件
  - [ ] 红测:approve → definition-seeded v1 → sitemap/flow-entry 生长;bornVersion=1;I5 一致
  - [ ] 绿:实现
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 5 — Meta UI 人机同门(D67.1/D67.2)

- [ ] Task: GenericCollectionRenderer 渲染集合级 actions
  - [ ] 红测(component):meta/drafts 集合页渲染 create 控件;提交前 fresh-read;无 actions 集合零变化;I3 fuzz 断言控件均映射声明 action
  - [ ] 绿:MetaActions 集成,scope-preserving
- [ ] Task: application-bundle 人类编辑 schema
  - [ ] 红测:view-models/draft-editor-schema 对 application-bundle 给出结构化必填根 + blocking-fields 聚焦
  - [ ] 绿:实现(零 AI)
- [ ] Task: Draft 视图/创建流 kind 支持
  - [ ] 红测(component):draft detail 对 application-bundle 呈现 validation/diff/checks;创建→详情导航闭环
  - [ ] 绿:实现;registry/classes 不新增特化则走既有 generic
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 6 — 同门闭环验收(两门同跑;agent 双通道端到端)

- [ ] Task: CLI application-bundle 全环(G3/US9,agent 门)
  - [ ] 红测:apps/cli 单测(--kind application-bundle 显式 lens;create/revise/validate/diff/submit/get/watch envelope 全链)
  - [ ] 红测:CLI approve 尝试拒绝(APPROVAL_FORBIDDEN 口径回归)
  - [ ] e2e/cli-meta-drafts.spec.ts 增例(真实 server):批准后 apps/flows 立即发现新 app/新动作
  - [ ] 绿:实现
- [ ] Task: Chat 同门故事(US6)
  - [ ] 注入驱动协议测试:Assistant 经 meta exec 合同提交 application-bundle 提案(同一裁决路径);可选真实 LLM eval(pnpm eval:llm 口径)
- [ ] Task: Playwright Golden Story(US1–US3 浏览器门;agent 验收路径的可重放回归镜像)
  - [ ] e2e 新 spec:提案→修正→diff→approve→出生→集合可见→重启 bootstrap no-op
- [ ] Task: agent 同门与不变量扩展(US5/US8)
  - [ ] 批准后 CLI/HTTP 立即发现新 app/新动作(S2 精神);I3/I4/I5/I6 相关断言入 invariants 套件
- [ ] Task: 端到端 agent 双通道验收(US10;编排 agent 代行,逐步留痕)
  - [ ] 准备:`pnpm dev:all` + `pnpm cli:build`,干净本地环境与 CLI 配置
  - [ ] 浏览器门:agent 操作真实浏览器走完人类 Golden Story(导航/创建/修正/diff/approve/出生确认)
  - [ ] CLI 门:agent 以真实 CLI 二进制走完 US9 全环
  - [ ] 留痕:每步记入 evidence/evidence-agent-acceptance-<date>.md(步骤号/通道/动作/命令或 URL/合同证据/断言/结果)+ 截图与命令抄本目录
- [ ] Task: 第一性原理路径审查(US10;spec §6.8 清单)
  - [ ] 逐步核对:合同动作映射/裁决序可见/agent 零 approve/拒绝留痕/事实合同来源/人机同门/出生仅事件日志/授权仅授予集合×归属
  - [ ] 发现项登记→修复→复跑(≤2 轮,workflow 口径);审查结论写入 evidence 文件
- [ ] Task: Phase Verification & Checkpoint (Refer to workflow.md)

## Phase 7 — 收口

- [ ] Task: 全量门禁:`pnpm check`(governance:strict)+ `CI=true pnpm e2e` + `CI=true pnpm e2e invariants`
- [ ] Task: 文档同步(AGENTS.md 模块图如新增文件;DECISIONS/GOAL 引用核对)+ conductor-review 修复环
- [ ] Task: 里程碑可运行验证:`pnpm dev:all` 起服,浏览器实测 US1–US3(自治验收,证据入 git notes)
- [ ] Task: 部署站双通道复核(按 DEPLOYMENT.local.md 标准升级流程;不阻塞本地 DONE,是否当次发布由用户裁定)
  - [ ] 固定 SHA 构建 linux/amd64 images → home preflight/up/status → 公网验收合同
  - [ ] agent 在公网站点重跑双通道走查(浏览器人类门 + CLI 设备凭证 agent 门),证据追加 evidence/
- [ ] Task: Track 收口(archive、registry 状态更新、DONE 摘要引用 evidence 文件与第一性原理审查结论)
