# T7 骨架与渲染切片 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: 词汇表与 binding-only 渲染核心 `[checkpoint: ea54554]`

- [x] Task: render spec 类型 + 零字面校验器 + 解引用器(纯函数)(TDD:I2 property test)(10686ee)
- [x] Task: 词汇表注册表 + A2UI 扩展目录形状(SDK 调研结论落 DECISIONS;薄协议层)(595423a)
- [x] Task: 凝固机制(render-spec-frozen 事件;concern-key 持久化)(TDD)(ea54554)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md)(ea54554)

## Phase B: 组件词条实现与骨架面

- [x] Task: 十词条组件接入(table/chart/stat/timeline/kanban/markdown/detail;form/diff 复用)(组件测试)(9557395)
- [ ] Task: 画布 /canvas(A2UI surface 宿主;action 拦截映射;data-action/data-nav 全站标注)
- [ ] Task: 主页态势投影 + 事件流 /events(timeline 零 AI)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: render capability 与 S5

- [ ] Task: 聊天 render 意图 → spec 生成(rule 确定路径:图表词+维度引用;LLM 路径接口)(TDD)
- [ ] Task: S5 E2E(聊天→chart surface;spec 零字面;数值与快照一致;凝固)
- [ ] Task: I3 E2E(fuzz 全页面;未声明按钮拒提交)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
