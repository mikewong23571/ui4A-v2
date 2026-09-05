# T56 Planning Review

日期：2026-09-05。范围：本 track 规划文档与 registry 接线；代码事实基线 `de661e29`。
评审方式：主 agent 在初稿后单独进行规划自审；没有独立 reviewer，不声称完成实现 review。

## Summary

规划包含完整目标、边界、事实来源、三个有界探针、12 条用户故事、执行顺序和实现后审查门禁；
可交给 coding agent 从 P0 开始执行。运行时方案尚须探针验证，规划通过不代表功能实现或线上问题已修复。

## Verification Checks

- [x] Plan Compliance：用户要求仅规划；所有 P0–P5 实施任务未勾选，未改应用代码。
- [x] Self-contained：原观察、样例、布局、约束、数据、US/FR/G 映射、命令与 review 标准均在本目录。
- [x] Source Review：核对 work-thread 投影、材料/pin、Presentation、chat/history/citations、D44/D46/D47/D51/D54/D68 与已有 T54 能力。
- [x] Scope Review：不部署、不改业务生命周期、不新增状态库/依赖，不把 UI 重构扩大为 agent runtime 改造。
- [x] Governance Baseline：规划期 `pnpm governance` 退出 0；空例外，贴限目录已在 design 标注为开工重测项。
- [x] Document Validation：7 个文件、28 个父任务、6 个 checkpoint、12 个故事、10 个 FR、7 个 Gate；链接、元数据、未开工状态、既有测试路径检查通过。新文档使用 `prettier --ignore-path /dev/null` 显式检查，避免 conductor 默认忽略造成空跑。
- [ ] Implementation Review：NOT RUN，必须在 P5 执行，不能在规划期勾选。

## Findings 与规划修订

| ID   | 风险                                                              | 已落入规划的约束/修订                                                             | 复审结论     |
| ---- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------ |
| PR01 | 把减少一栏误作全部交付，或以 React 特判做本线 dashboard           | FR1/2/10；S1 必验合同→同一 Presentation；P1 先于 P2，失败不可退为 CSS 收口        | 规划层已解决 |
| PR02 | 归档被当作成功，或因归档隐藏仍待决定的关联责任                    | FR3/6；US04 正负例，生命周期与验收分开，责任不被呈现姿态吞掉                      | 规划层已解决 |
| PR03 | 本地 pin 被写成业务材料；移除失败同时清 pin                       | FR5；US06 明确两种关系、提交成功边界及 archived 无动作                            | 规划层已解决 |
| PR04 | 用今天集合第 N 项解释历史引用，造成错指                           | FR8；S2 明确 FactRef 无快照事实，集合级来源/原 pointer 诚实降级，US09 重排负例    | 规划层已解决 |
| PR05 | 同 session 跨线时为旧回合贴当前线标签；以当前值回填历史           | FR7；精确 principal/session/turn join，unknown 原样，US08/09 与 P3.3/3.4          | 规划层已解决 |
| PR06 | 所有门禁通过但真实 LLM 被 skip，或没有实现后 review 就归档        | G4/G7、P4/P5 明确 NOT RUN 不算 PASS；必需故事不能转成建议以绕过关闭条件           | 规划层已解决 |
| PR07 | “只读零事件”误伤现有消息挂线/审计；“无全库扫描”缺少历史页边界验证 | 复核 chat-thread.ts/history route 后补精确事件口径、超过读取页边界的 S2/P3.3 验证 | 规划层已解决 |
| PR08 | eval 命令缺少 opt-in 会 skip；新文件不在固定 project 清单不会执行 | G4 补 RUN_LLM_EVAL=1、成对测试库变量、working-context project 与配置注册纪律      | 规划层已解决 |

## 待实施验证，不是规划遗漏

- S1 最终单主体/derived Composition 路线与新增读语义是否必要：P0 实测，出口清单已明确。
- S2 历史 join/引用标签可取得的数据边界与存储读过滤：P0 实测，不假设已有快照能力。
- S3 响应式切换与 assistant-ui 草稿生命周期：P0 实测，不以静态示意代替可运行验证。
- 真人五秒恢复目标尚未测；记录为体验观察，不伪造“厌烦感下降”。
- 线上版本与本地 SHA 未核对，发布不在本 track 授权内；运行时与部署证据严格分开。

## 复审后的关闭纪律

上述修订已落实到 spec/design/acceptance/plan；本报告仅是规划自审。
后续实现必须生成独立 `review.md`，有 finding 时执行 Review Fixes 和 re-review，
对最终代码树复核后才可标记完成。当前 metadata 保持 new，全部实施任务保持 `[ ]`。

---

# P0 定案 review（2026-09-06，P0.5）

范围：S1/S2/S3 探针定案（`probes/*.md`）与 DECISIONS **D78** 落档后，以 spec FR1–FR10
与 US01–US12 为检查表逐条复核定案后的设计覆盖；另做五项特别边界检查。出处缩写：
d=design.md、s=spec.md、a=acceptance.md、p1/p2/p3=probes/s1、s2、s3 报告、D78=DECISIONS D78。
结论：**全部 FR/US 有定案支撑的覆盖路径，无阻断缺口**；发现项全部可收敛为文末三项
P1+ 处理项（其中一项非缺口，显式记录防范围蔓延）。

## FR 逐条判定

| 项 | 判定 | 依据与出处 |
| --- | --- | --- |
| FR1 本线是主内容主体 | 覆盖 | D78 决定 1 撤销 T35 恒三栏/本线即 noGaze 假设；d §1 概览即主面；p1 §4 实测 focus=thread:\<id\> 已走同一 generic Surface（identity/status/resume/actions/relation/repeat），证明撤旁路后同管线成立。对应 US01/07。 |
| FR2 目标/状态/责任/依据层级 | 覆盖 | d §2 呈现优先级 1–5；D78 决定 2 成员卡 + version:1 声明补「当前责任/进行中工作」读面；p1 §4 traits 对照定位缺口（责任/进行中通路缺、词表够）由 P1.2 扩展闭合（见 P1+ 项 2）。对应 US01/02/03。 |
| FR3 处境安排注意力、不发明状态 | 覆盖 | d §2「禁止的推断」列；p1 §6 空/终局/未知/dangling 全用封闭词表 emptyMeaning 与合同原词，未知状态不做词表外推断；open/paused/completed/archived 写语义零变化（D78 决定 2/4）。对应 US03/04/10。 |
| FR4 一主工作面与响应式 | 覆盖 | D78 决定 1 实测断点（384px→1072、320px→1008、200% 必覆盖、640 绑定约束、默认无永久材料栏）；d §1 已回写同组数字与现状违反基线。对应 US05/12。 |
| FR5 材料关联与 pin 语义一致 | 覆盖 | d §2 pin 行（固定视图快捷入口、不转业务关联）与 d §4 材料行未受探针改写；S3 仅改书桌条目导航方式（裸 `<a>`→Link，存续前置），不动 membership/pin 语义。对应 US06/04。 |
| FR6 知情决定同一工作面闭环 | 覆盖 | D78 决定 2/4：责任到达 = approval 成员卡（携带被引确认实体 approve/reject 声明动作，D50 责任卡）；线生命周期动作不充当责任源且现状不加确认门（见特别检查 4）；a §2 US02 提交仍走 confirmation:\* 既有闸门与回执。对应 US02/04/10。 |
| FR7 聊天的当时与当前分开 | 覆盖 | D78 决定 5：ChatTurn 增 clientView?/userContextKnown、不回填、未知显式、禁当前观察补旧消息；发送侧 clientView 与 URL 同源已实测（p3 §3），输入附近常显提示的数据源即 URL observation，列 P2/P3（d §2「当前提问对象」行）。对应 US07/08/12。 |
| FR8 依据可辨、可达、时点诚实 | 覆盖 | D78 决定 5：精确型/集合型两型 chip + 时点边界行，判别纯指针前缀不解析回答自然语言；FactRef 不变（D47）；改名/403/网络失败诚实回退 rel 已实测（p2 §1 步骤 4）；不建全局标签缓存。对应 US09/10/12。 |
| FR9 低暴露而可恢复 | 覆盖 | d §5；p1 §6 resume 被裁整行消失不加占位、dangling 用既有「对象不存在」、引用读取失败不炸整条消息（p2 步骤 4）；Escape/焦点恢复/初始焦点现状缺失已入 d §1 违反基线，P2.1 Red 覆盖。对应 US05/10。 |
| FR10 同门与持续新鲜度 | 覆盖 | p1 §4：每次 present 同一授权读面，值/成员/动作/授权四类 rehydrate/invalidate 接线实测已存在，D78 决定 2 零新增失效机制；历史读取 {rel,principal} 过滤取界防静默截断（D78 决定 5）；人类/HTTP/Assistant 同门由既有 authorized-entity/Sidecar 每次重授权保持。对应 US03/06/07/10/11/12。 |

## US01–US12 覆盖抽查

- **US01**：FR1/FR2 路径成立；p1 surface 树已含身份/状态/resume 与成员 repeat，主区域
  不再是说明书/书架（D78 决定 1）。判定：覆盖。
- **US02**：approval 成员卡 → member-card（D50）+ fresh submit；agent archive 直通现状
  （D78 决定 4）不影响 US02——其决定源是业务 confirmation:\*，不在 thread 路径。判定：覆盖。
- **US03**：active 成员卡 + 合同状态原词；值变化同 Sidecar 命中、客户端 entity cache
  deref 更新（p1 §4），无需手动刷新且不抢阅读位置。判定：覆盖。
- **US04**：archived 动作组为空（再验）、approval 成员卡与线状态解耦（p1 §6 终局行，
  归档仍有责任可到达且不写「无需处理」）。判定：覆盖。
- **US05**：断点定案 + d §1 现状违反基线（1080 三栏 240、390 横滚/裁边、768 挤压、
  H1 违反）即 P2 Red 期望值；a G3 已挂 `probes/s3` §1/§2 基线。判定：覆盖。
- **US06**：未受探针改写，沿 d §4 材料行与 a US06 原计划；S3 补充负例——书桌条目必须
  客户端导航（硬导航丢草稿）。判定：覆盖。
- **US07**：p3 §3 clientView 发送侧与 URL 同源实测 + 硬导航根因消除（d §4 材料行/
  页面行）；从外部直进对象不隐式建线为既有行为，未涉改写。判定：覆盖。
- **US08**：D78 决定 5（精确 join、缺失三态可分、不回填、未知显式；历史读取过滤取界）。
  判定：覆盖。
- **US09**：两型 chip + 时点边界行 + 原 FactRef 保留（D78 决定 5）；今日第 N 项不伪装
  当时成员（p2 §2.3）。判定：覆盖。
- **US10**：裁剪同形「当前可见」口径（D78 决定 3）+ p1 §3 无泄露实证 + 撤回后诚实回退
  rel、无缓存残留（p2 步骤 4/§2.4）。判定：覆盖。
- **US11**：路线 A 合同驱动、generic 零 class/rel 分支（p1 §5 fixture H 论证）；历史/
  列表读取有界取界、无默认页截断（D78 决定 5）。判定：覆盖。
- **US12**：真实 LLM 门禁不变（a G4）；发送侧 clientView 同源已证；单飞与 citations
  归属注意事项见 P1+ 项 1。判定：覆盖（自动化部分待 P4 执行）。

## 特别检查点（五项）

1. **授权边界（D51 裁剪口径）— PASS**：p1 §3 六处裁剪逐引用生效且无计数/名称/存在性
   泄露；成员卡作为 entities 子实体天然继承同一 readable 谓词。D78 决定 3 明文
   「裁剪=真空同形 → 当前可见口径、禁『无进行中工作』式全称陈述、resume 被裁整行
   消失」；「被裁剪 vs 真空可辨读字段」仅列为 D51 审查后备选，本 track 不默认做——
   与 D51 无冲突（不引入任何会话/scope 类授权输入）。
2. **缓存失效（S1 四类接线）— PASS**：值/成员/动作/授权四类变化的
   rehydrate/invalidate 实测全部已存在（p1 §4），路线 A 零新增失效机制；d §5 与
   a G1 replay 断言保持；S2 侧「不建全局标签缓存、失败值不缓存」与 FR10 同向。
3. **历史边界（S2 过滤取界 + 不回填）— PASS**：D78 决定 5 明文 {rel,principal} 过滤
   取界、禁默认页 limit（101 硬顶静默截没实证）、不回填（与 D68.5 同纪律）、禁用最新
   presence/当前 URL 补旧消息（D51 注意力纪律）；local profile 无 principal 过滤的现状
   已记录，S2 join 显式带 principal，生产走 chatHistoryPrincipal。
4. **动作裁决（生命周期维持现状）— PASS（边界显式）**：D78 决定 4 把
   `apps/web/src/engine/exec/service-exec.ts` THREAD_REL 直入 `execThreadAction`、
   `'requires-confirmation': 'high'` 标注不生效记录为已知现状（p1 用例 3 固化），
   本 track 维持不改——d §5「运行/暂停/结束/归档只改变呈现重心，不改变业务执行
   合法性」；该点显式写入决定防止被误读为遗漏；后续如需确认门属新范围须另行决策。
5. **布局契约（S3 断点与 d §1 一致性）— PASS**：d §1 已回写 640 绑定约束、
   `vw−48−助手宽≥640`、384→1072、320→1008、200% 覆盖、60% 恒满足、现状违反基线，
   与 p3 §1.1 实测表和 §1.2 推导逐项一致；a G3 期望值基线同源。

## P1+ 处理项（review 发现缺口及处置）

1. **citations 归属按「最后一条 assistant」而非 turnId**
   （`withCitationsOnLastAssistant`，p2 §1 步骤 5）：composer 单飞门禁存续时为理论缺口。
   处置：P3.3 改 chat 状态拥有者（S3 定案）时必须保持单飞语义或把归属改为按 turnId；
   已记录于 p2，不进 D78（非本轮定案必需范围），实施期在 P3.3 钉住。
2. **generic 规划器非密度 trait 消费通路缺失**（p1 §4 对照表：词表够、通路缺）：
   按 p1 §7.2 在 P1.2 实施——沿 `packages/engine/src/presentation/surface/` + catalog
   词表扩展，`PRESENTATION_SURFACE_CATALOG`/`generic-intent-policy` 版本递增，禁
   class/rel 分支；若 P1 以成员卡内声明行表达分组可再缩（d §4 语义/呈现行已回写）。
   处置：属计划内 P1.2 工作，非设计缺口。
3. **「被裁剪 vs 真空」可辨读字段**：仅 D51 审查后备选，本 track 不默认做
   （p1 §7.4；D78 决定 3 边界）。非缺口，显式记录防范围蔓延。

## 定案 review 的关闭口径

本节仅覆盖 P0 定案与设计文档一致性；不代表任何实施验证。P1–P5 的实施、浏览器、
真实 LLM 与实现后 review 证据仍按 plan/acceptance 原门禁执行。
