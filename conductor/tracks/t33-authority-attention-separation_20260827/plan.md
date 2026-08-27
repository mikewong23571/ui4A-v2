# T33 授权与注意力范畴分离 — Plan

> 遵循 `conductor/workflow.md` 的任务生命周期、Git notes 与 Phase Checkpoint 协议。
> spec:`./spec.md`(含 D51 五条终态不变量与测试三分纪律;锚点全为路径+符号,
> 实施前以仓库现状复核)。
> 每 Task 先 Red 再 Green;每 Phase 结束复跑 `pnpm check` 与
> `CI=true pnpm e2e invariants`(Phase C 起含五景新走查)。
> 治理纪律:**净行数预期为负**;GR2 不留双路径(旧机器直接删);触及
> shrink-only 基线目录的改动顺势收缩基线;例外登记由编排 agent 统一执行。
> 测试三分纪律(spec"测试三分纪律"节):回归锚不许红 / 旧语义钉子先删后立 /
> D51 五条不变量为唯一方向准绳——不为救绿妥协产品代码。
> 冲突面:T32 在途(assistant-ui/chat 表层组件重叠极小);应急修复
> fix-0a36f20 已部署,其 durable key 冻结缺陷由本 track Phase B 根除。
> 前置确认:D51 尚未登记(Phase 0 落);T29 presence 投影已存在可复用;
> `pnpm` shim 异常时用 `./node_modules/.bin/*` 直调。

## Phase 0: 立宪(D51 登记 + 五景 E2E 见红)

- [x] Task: DECISIONS.md 落 D51 授权与注意力范畴分离 [49c4e91]
  - 内容四段:范畴错误根因(单值 policyScope 双消费者)/ 五条终态不变量
    (spec 同款)/ 幸存三物(发现过滤、自治体围栏谓词、token 授予词汇)/
    退役清单(defaultPolicyScope、scopeCoverage、selection、durable key
    维度、GR6 扫描器);
- [x] Task: 五景 E2E 骨架 `e2e/t33-authority-attention.spec.ts` [49c4e91]
  - a. `/canvas?focus=post:post-welcome` 直达渲染(无 sidecarId);
  - b. present→ready→sidecar 回放→画布可达(publishing 实体链);
  - c. 未授予该应用的用户 → 结构化 denied + 人话文案(断言无机制词);
  - d. 他人 sidecar id GET → 404;
  - e. 多主体切换零 denied(五个 granted rel 连续呈现全 ready/fallback);
  - **执行记录(偏离已如实登记)**:a/b/e 以常绿旅程锚落地并通过(cold-start
    窗口放宽至 30s,防与 dev 首编竞速);c/d 的判权语义需多凭证环境,
    可红证据按测试三分纪律移至 Phase B route-vitest 锚点,e2e 内 fixme
    占位防清单缩水;五景完成定义不变——Phase B/D 后五景全部有可执行证据。
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) [49c4e91]

## Phase A: 内核收口(packages/engine + apps/web/src/auth)[checkpoint: 216a6e4]

- [x] Task: UserSidecarKey 去 policyScope 维度 [216a6e4] [`packages/engine/src/presentation/sidecar.ts`]
  - 键回归 principal/intent/device/subject 四元组;sidecarKeyFingerprint
    逻辑不变;内核内构造/读取点同步;授予变化走既有依赖失效重规划
  - mutation 抽查:恢复 scope 字段参与指纹 → 现有键稳定性测试变红口径重新
    审视而非回退
- [x] Task: application-scope 受众语义重写 [216a6e4] [`apps/web/src/auth/application-scope.ts`]
  - 新:`assertReachable(context, rel, grantedApplications)`(fail-open
    unknown → guard 兜底)、`filterEntityForGrantedApplications`;
  - 删:`relCoveredByPolicyScope`、`assertRelInPolicyScope`、
    `filterEntityForPolicyScope` 单值版、`selectCoveringPolicyScope`
    ([`apps/web/src/engine/situation.ts`]);
  - filterSitemapForPolicyScope 单 scope 切片保留仅供并集复用;
  - 配套单元测试按 D51 口径新写(audience 边界、unknown fail-open、私有物 owner)
- [x] Task: request-identity 减法 [216a6e4] [`apps/web/src/auth/request-identity.ts`]
  - 删 defaultPolicyScope/scopeCoverage 与整套默认回退(identity 不再产出
    selected scope);identity 增 grantedApplications(ui4a:policy:* 解析);
    ?scope= 仅作导航偏好透传;
  - 整体退役 `request-identity-scope-coverage.test.ts`;production-auth 套件
    fixture 去 policyScope 必填
- [x] Task: Phase Verification & Checkpoint [216a6e4](tsc 七包绿;红名单由 B 机械适配当场清零,见 D51 影响)

## Phase B: 咽喉点与呈现面接线 [checkpoint: c0ae492]

- [x] Task: 六路由换新谓词 [c0ae492]
  - `api/entity`、`api/exec`、`api/exec-plan`、`api/presentation`、
    `api/meta/entity`、`api/meta/exec`:移除 identity 级 scope 选择,
    assertReachable(grantedApplications) 替换;chat 路由纵深检查改集合口径
- [x] Task: presentation runtime/broker 收口 [c0ae492]
  - trustedContext = {grantedApplications};durableKey 四元组;dependencies
    `policy:*` 改授予集合指纹;lifecycle namespace 随键同源;
  - 失败回执区分 denied(reasonCode)/subject-unavailable,不再统一压缩成
    authorization-failed([`packages/engine/src/presentation/broker.ts`])
- [x] Task: sidecar GET 语义拆分 [c0ae492] [`apps/web/src/app/api/presentation/sidecar/route.ts`]
  - getSidecarById 后按 principal 分流:跨 principal → 404;本人 stored 工件
    重审失败 → 结构化 denied;stored 授权集合 ⊆ 当前集合校验替代冻结相等
- [x] Task: situation 单点装配 + 导航偏好降级 [c0ae492]
  - explicit > presence > 未定位(chat-situation/startRel 从装配点取 lens);
  - 客户端 `withPolicyScope` 的 ?scope= 后端不再作为鉴权输入
- [x] Task: 客户端诚实失败 [c0ae492]
  - canvas body 区分 unknown/denied 分支人话;presentation notice 扩展
    denied reason 映射(有界活动措辞;对话内解释由助手基于回执生成,
    不得以模板扩写冒充理解——§六文案滑梯纪律)
- [x] Task: Phase Verification & Checkpoint [c0ae492](五景 a/b/e 绿;c/d 锚点落 Phase B vitest——偏离:e2e 层多凭证装置成本不成比例,vitest 即证据,已在 e2e 注释与汇报登记)

## Phase C: 注意力核对与新应用零改动证据

- [ ] Task: agent 披露不回归核对(T25/T29 成果)
  - L0/L1/L2 切片来源均为 situation 单点;全库 grep 无路由旁路自算 lens;
  - CLI 纪律证据测试:HTTP 合同(sitemap/entity)按授予并集返回不窄化,
    prompt 切片收窄仅发生在披露装配层(§八三纪律)
- [ ] Task: 新 application 注册演练证据测试(D51 不变量#5)
  - fixture 级假应用仅动注册数据;断言五景行为与五条不变量全部零代码分叉
- [ ] Task: Phase Verification & Checkpoint(五景全绿 + `CI=true pnpm e2e invariants`
  + 重放哈希套件)

## Phase D: 治理收尾

- [ ] Task: GR6 扫描器退役
  - 删 scripts/governance/check-identity-scope.mjs/.test.ts + run-all 登记 +
    exceptions.json identity-scope-selection section(执法主体移交类型系统,
    理由入 D51);
- [ ] Task: AGENTS.md / GOAL.md 条目更新
  - AGENTS.md Governance Gates GR 段改为"D51 分离不变量"(评审准绳非脚本);
    GOAL.md 记录 track 链接
- [ ] Task: 全量 `pnpm check` 终绿(governance size 基线预期收缩,只减不增)
- [ ] Task: Phase Verification & Checkpoint

## Phase E: 发布与生产走查

- [ ] Task: 构建三镜像(SHA=release commit)→ save/scp/ctr 导入 k8s-w-1/w-2 →
  immutable digest(runbook §3 已验证流程)
- [ ] Task: mothership overlay 更新 web/worker/runner digest(adminWorker/
  pkiRunner 不动)→ verify-overlay PASS → retained jobs diff 零 → helm upgrade;
  image-release.json 证据更新
- [ ] Task: 生产真人走查
  - 重建原事故对话("我想看看《当前应用的用户故事与操作流程》"+"再试试")
    → 一次到位零授权字眼;focus 直达;d. 景若可造则验
- [ ] Task: Track 收尾
  - index.md 状态行/DONE 报告;conductor/tracks.md 状态流转;归档判据核对后
    提请 closure 评审(GR5:无 bespoke 残留,e2e 走查评估并入常驻 or 删除)

## 验收标准(Track DoD)

1. 五景 E2E 全绿且被证明能红(Phase 0 已见红);
2. D51 五条不变量各有可执行证据(类型约束 + 定向测试 + 注册演练);
3. 回归锚全绿:I1–I7、重放哈希、Golden Story;`pnpm check` 终绿,
   governance 基线只减不增;
4. 生产走查:原事故场景一次到位,全程零可见授权事件;
5. D51/AGENTS.md/index 文档闭环;净行数为负或近零(governance 数据佐证)。
