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
