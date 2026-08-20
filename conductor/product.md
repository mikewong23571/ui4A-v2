# UI4A v2 — 界面作为合同 (Interface as Contract)

## 使命

构建一个"界面作为合同"的应用——人和 AI 面对同一套业务流程、共享同一套流程知识;软件为 AI 操作而写,代码只是副产品。

HTTP 合同是唯一真相:renderer 给人、HTTP 给脚本、tools/MCP 给模型——三个投影,一套事实。验收方式遵循项目自身的论题:**每个场景由两种执行者各跑一遍——人类走 renderer,agent 走合同(tools/HTTP),同一套场景,同一份日志。**

## 背景

- 架构设计已完成(见 `docs/UI4A-v2(重排版):界面作为合同,应用作为数据,能力作为边界.md`,架构正典);
- 技术选型已定(见 `docs/UI4A-技术选型.md`):全部用社区轮子,不自造——XState 定义业务流,PostgreSQL append-only 存事件,Siren 投影合同,Cedar 裁决权限,Keycloak(RFC 8693)发委托,Temporal 跑能力与委托,AI SDK + assistant-ui 聊天,A2UI 作渲染协议,RJSF 哑兜底,shadcn 拼骨架;
- 业务平面(引擎 + 三层裁决 + Siren 投影 + 双 driver agent + 悬浮聊天)已在原 Clojure demo 中端到端验证,按选型迁往 TypeScript,架构经验 1:1 平移;
- 本项目 = 按图纸施工:从零实现完整应用。

## 成功标准(DONE 的定义)

以下场景套件与不变量全部自动化通过(E2E),外加一次人工 demo 走查。

### 基线场景(业务平面,继承自已验证 demo)

| # | 场景 | 断言 |
|---|---|---|
| B1 | 委托发布:"帮我发布一篇文章" | 三步按 schema 填充 → 发布 → 文章真实落库 |
| B2 | 点名下线:"把 post-welcome 下线" | 经子实体链接直达,精确下线一篇,其余未受影响 |
| B3 | 审核队列:"审核所有待处理评论" | pending 清零,事件留痕 |
| B4 | 失败呈现:配置无效 API key | 401 如实进入对话,委托不崩溃 |

### 切片场景(v2 核心,每个对应一条架构主张)

| # | 场景 | 断言 |
|---|---|---|
| S1 | 确认门 | agent 执行高风险 archive → 动作未生效,挂起为 pending 实体 → 人类 approve(actor=human)→ 生效;日志含 actor/principal/信道 |
| S2 | 最小 meta | agent 经 `_meta` 提交"新增一条边":缺 guard 的非法定义被拒且留痕 → 修正 → 人类在机械 diff 上批准 → sitemap 重生成 → agent 下一步即可用新动作,无任何 prompt 改动 |
| S3 | 委托实体 | 两个 agent 并发操作同一资源:一个成功、一个拿到带原因的拒绝(裁决器即并发控制);杀掉执行中的委托,新 agent 从实体续跑 |
| S4 | plan-exec | 六步向导在一次决策内完成,轨迹为一条批量裁决记录,每步裁决可见 |
| S5 | 渲染 | 聊天说"按分类展示文章" → A2UI surface 渲染图表;渲染 spec 中不含任何字面数值,全部为实体引用 |

### 不变量(铁律的自动化形式,持续运行,违反即迭代无效)

| # | 不变量 | 验证方式 |
|---|---|---|
| I1 | 零智能完整 | 撤销全部 LLM key:B1–B3、表单版 S1、哑渲染仍全部通过 |
| I2 | 事实不可发明 | property test:渲染 spec 解引用后的值与实体快照一致 |
| I3 | 交互必背书 | fuzz 所有可点元素:提交必映射到已声明 action,合同外按钮无法提交 |
| I4 | 审批不委托 | 以 agent 身份执行 approve 必被拒 |
| I5 | 可重放 | 从空库重放事件日志,实体状态 hash 与重放前一致 |
| I6 | 拒绝留痕 | 每个被拒动作在日志中带原因,且可作为下一步决策上下文获取 |

## 五条铁律(不可违背)

1. **AI-optional**:机械层零智能时必须完整工作;AI 只改善体验,不承担正确性(三处 AI,三处哑兜底);
2. **binding-only**:模型只发引用不发内容——渲染器从实体缓存解引用,模型发不出一个数字;
3. **交互必须 action 背书**:任何可点的按钮必须绑定到已声明 action,提交经引擎裁决;
4. **事实永不发明**:字段的值来源必须声明(默认/查找/引出/效果产出/意图/起草+选择),agent 猜只对价值载体字段合法且过选择门;
5. **审批不委托**:`approve` 永远 `actor-is-human`;审计渲染(事件流、机械 diff)路径零 AI。

## 施工顺序(五条垂直切片)

1. **确认门切片**:guard 挂起语义 + pending 确认实体 + notify(Temporal activity)+ 收件箱;Cedar 风险策略;actor/principal 入日志;
2. **最小 meta 切片**:flow 定义从代码挪进事件日志(XState machine-as-JSON)+ definition-lifecycle + 激活不变式 + 机械 diff + RJSF/Stately 做 BIOS;
3. **委托实体切片**:agent 执行迁入 Temporal workflow——崩溃续跑、N 路并行、舰队队列页免费获得;
4. **plan-exec 切片**:批量裁决计划,一次决策、机器速度执行;
5. **骨架与渲染切片**:widget 画布 + 渲染词汇表(TanStack Table / shadcn Charts / Tremor / react-chrono / React Flow / dnd-kit,注册为 A2UI 扩展目录)+ 主页态势投影。

**每个里程碑结束系统必须处于可运行状态**(切片化施工,任何时刻停下不留废墟)。

## 约束与协作规则

- 技术栈严格按 `docs/UI4A-技术选型.md`,不自造轮子;
- 违反任何一条铁律 = 该迭代无效;
- 实现与文档冲突时:先在 `DECISIONS.md` 记录分歧与决定,再动代码或文档。

## 范围边界

DONE = **demo 质量**。生产化(多租户、部署硬化、压测、真实 SSO 对接)显式排除在外。

人工评估点(不阻塞 DONE,单独记录观察):确认疲劳的真实感受、澄清对话的收敛体验、机械 diff 的可读性、渲染凝固后的稳定性。
