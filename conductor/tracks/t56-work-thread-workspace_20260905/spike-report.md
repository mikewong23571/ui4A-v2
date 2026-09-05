# T56 Spike Report（探针定案索引）

> 用途：登记 P0 三个必做探针（design.md §3）的执行状态，并作为详细报告的索引。
> **当前状态（2026-09-06，P0.5 回写）：S1/S2/S3 已全部执行完成**；各出口定案以 `probes/`
> 下详细报告为唯一事实来源，本文件每节只保留一段结论与链接。原骨架的待回填清单已全部
> 完成（各项标记 [x]）。探针代码去向按 GR5 记录于各报告相应小节。纪律：原始观察 ≠
> 部署事实；每个出口结论必须能指回 `evidence.md` 的正式证据条目（E-P0.2–E-P0.4）。
> 三探针定案已并入 **DECISIONS.md D78**（T56 P0.5）。

| 探针 | 任务 | 状态   | 详细报告                        | 结论位（本文件） | 证据条目 |
| ---- | ---- | ------ | ------------------------------- | ---------------- | -------- |
| S1   | P0.2 | 已完成 | [probes/s1-presentation.md](probes/s1-presentation.md)               | 本文件 §1 | E-P0.2   |
| S2   | P0.3 | 已完成 | [probes/s2-history-citations.md](probes/s2-history-citations.md)     | 本文件 §2 | E-P0.3   |
| S3   | P0.4 | 已完成 | [probes/s3-layout-session.md](probes/s3-layout-session.md)           | 本文件 §3 | E-P0.4   |

共同基线：HEAD `c38883b074d30620008eeacbf4bfe5c5f864b1f5`（S3 被测 HEAD `493dc67d`，
仅差编排 agent 的 plan.md [~] 标注）；环境约定与治理基线见 `evidence.md` E-P0.1。
隔离库分别为 `ui4a_s1_test` / `ui4a_s2_test` / `ui4a_s3_test`（5433；未触 dev 库与
`ui4a_test`），复跑命令与退出码见各证据条目。

---

## §1 S1：本线整体如何进入现有呈现链路（P0.2）— 已完成

**结论**：选定**路线 A**——以原 `thread:<id>` 作为公共认知根，在
`packages/engine/src/projection/work-thread.ts` 纯投影中为 active/approval 补与 context
同构的 `thread-reference` 成员卡（approval 卡携带被引确认实体的声明动作），并把
`presentation` 经 `projectCognitiveSemantics` 升级为 `version:1` 认知声明；复用既有
Broker/generic/Sidecar，member/value/action/授权四类新鲜度接线实测已存在——零新增 rel、
零第二套状态、零新增授权机制、前端数据面零改动。备选路线 B
（derived Composition `workspace:thread:<id>`）实核机械可行但读放大与声明换版重规划
不省任何工作，否决为主路线，D45 机器留给 app workspace。两个需决策知悉的现状事实：
线程生命周期动作不经确认门（`service-exec.ts` 直入 `execThreadAction`）——本 track
维持不改（D78 决定 4）；授权裁剪与真空合同同形——UI 用「当前可见」口径（D78 决定 3）。
失败判定检查：两条路线均无需第二套状态或硬编码应用页，探针不判失败。
详见报告 §5（路线对比）、§6（空/终局/未知/裁剪分组）、§7（最小扩展清单）、§8（代码去向：
`service-tests/work-thread/presentation.test.ts` 保留为 P1.1 Red 种子）。

原待回填清单（P0.2 已完成）：

- [x] 隔离 fixture（一目标、两个跨应用 context、一 active、一当前 approval、一历史决定、一显式 event）搭建记录
- [x] exact Siren/授权/依赖记录（首选路线：thread 单实体 Surface）
- [x] 必要时 derived Composition 对比记录
- [x] 角色/责任/产出来源、同门、更新、部分授权与未知状态验证记录
- [x] 最终数据/rel/path/词汇/声明/模块方案及探针代码去向
- [x] 出口结论（选定路线 + 理由 + 失败判定检查）

---

## §2 S2：历史上下文与引用的时间边界（P0.3）— 已完成

**结论**：**写侧零变化，读侧一处扩展**。事件种类、chat-message-appended detail、
`FactRef{rel,pointer}`（D47）均不动、不加快照/版本字段；`ChatTurn` 只读投影新增
`clientView?` 与 `userContextKnown`（history 路由按 principal×sessionId×turnId 精确 join
同 rel 下 user 原话事件，join 键双全），存量历史不回填，历史未知显式「当时上下文未知」、
禁止用当前观察补旧消息。历史读取按 `{rel:'chat:<sessionId>', principal}` 过滤取界，
**不引入默认页 limit**——实测 `listEvents` 无默认上限、显式 limit 硬顶 101 会把页外回合
静默截没；既有 `order:'desc'+beforeSeq` 游标可用于未来真分页。引用 chip 分精确型
（「当前名」标注）与集合/成员型（集合级来源 + 时点边界行）两型，判别用纯指针前缀；
不建全局标签缓存（现状 no-store 即无失效残留问题）。live/history 缺口唯一在 ChatTurn
join 层；`withCitationsOnLastAssistant` 并发跨回合错挂为理论缺口，列入 P3 处理项。
测试落位：history 路由 DB 测试回原目录、映射纯函数落新子目录 `apps/web/src/chat/history/`、
CitationList 用例留 `components/chat/`、E2E 扩展现有 `chat-citations.spec.ts`（GR5）。
详见报告 §1（步骤 1–7 分步实证）、§2（出口逐项定案）、§2.7（代码去向：路由 DB 探针
文件删除、两枚组件种子保留为 P3 种子）。

原待回填清单（P0.3 已完成）：

- [x] A 线问 A 对象 → 切 B 线问 B 对象 → 刷新 的 live/history 对照记录
- [x] 缺 clientView 的历史回合、集合重排、改名/权限撤回、SSE 迟到 各负例记录
- [x] 原 event → history → ChatUiMessage → 展示 的映射链记录
- [x] `listEvents` 读取页边界实测（超过默认上限的同一回合重建）
- [x] 定案：join 与缺失策略、live/history 一致性、引用降级示例、标签缓存失效、必要字段变更与测试位置
- [x] 出口结论

---

## §3 S3：剩余宽度、草稿与流式生命周期（P0.4）— 已完成

**结论**：**640px 阅读下限在当前壳内结构性不可达**（main `max-w-5xl` 1024 + 书桌 384 +
padding/gap 72 → 注视列最多 568；1080 三栏中栏 240 实锤 F01）。并排/覆盖切换条件定案为
剩余宽度判断 `vw − 48 − 助手宽 ≥ 640`（且 ≥ 两栏净宽 60%，此时恒满足）：助手 384px →
阈值视口 1072，320px → 1008；200% 缩放（960 CSS px）必须覆盖/单面；不使用整屏 `lg:`
内层断点。chat 状态拥有者定案：根布局 FloatingChat 内 `useChatSession` 是工作站点唯一
拥有者（单文档内草稿/SSE/停止/会话选择全部存续，一切整页加载才丢）；消除硬导航是存续
契约前置（书桌条目 `thread-desk.tsx:290` 与壳内 `<a href>` 为裸 `<a>`，切对象丢草稿的
根因）；「进线必停靠」替换为剩余宽度判断并保留 dockedThread 记忆；Escape/焦点恢复现状
缺失，入 P2。探针脚本 5 个 `.mjs` 转正保留为 P2 Red 母本，34 张截图在 `probes/shots/`。
详见报告 §1（几何实测与阈值推导）、§2（存续矩阵与受控 SSE）、§6（唯一拥有者定案）、
§7（P2 Red 测试落位）。

原待回填清单（P0.4 已完成）：

- [x] 指定视口（1440×900/1280×800/1080×820/768×1024/390×844/200% 缩放）DOM 几何记录
- [x] 草稿未发送 + 可控 SSE + 切 focus/history/back + 关开层 的状态存续记录
- [x] `/chat` 独立页与 float/popout 回归记录
- [x] 定案：并排/覆盖阈值、覆盖交互、唯一 chat 状态拥有者
- [x] 出口结论

---

## 原始观察 ≠ 部署事实

- spec §2 的线上样例（ui4a.styleofwong.cn 工作线）是规划期浏览器观察，**未与本地 SHA
  核对，不作为本报告任何结论的依据**；三探针一律在本地隔离 fixture 上执行。
- P0.1 的「已知事实」均为对 HEAD `c38883b` 的只读代码核查（原骨架已由各探针报告与
  `evidence.md` E-P0.3 吸收）；运行时行为结论以 probes/ 详细报告与 evidence.md 正式
  条目为准，定案以 DECISIONS.md D78 为准。
