# T4 最小 meta 切片 — Plan

> 依据 `spec.md` 与 `workflow.md`(TDD)。状态:`[ ]` / `[~]` / `[x]`(附 SHA)。

## Phase A: definition-lifecycle 引擎语义(纯单测)

- [x] Task: lifecycle flow 定义(machine-as-JSON 自举,meta/self)+ 定义实体投影(meta/flows 草稿/活跃形状) (616a94a)
- [x] Task: 编辑动词过三层裁决(TDD:add-node/add-action[含 to-exists/guards-registered/effect-known guard]/submit/revise/deprecate;非法定义拒且留痕形态) (e26b30d)
- [x] Task: 激活不变式检查器(TDD:edge-targets-exist/guards-registered/field-types-known/effect-known/initial-exists+terminal-reachable;checks 入 activation;checks-fail→draft 附报告) (6a05452)
- [x] Task: approve/reject(actor-is-human;approve→active+版本+sitemap bump 信号事件 definition-activated;reject reason)(TDD) (ed5f96d)
- [x] Task: Phase Verification & Checkpoint(Refer to workflow.md) (3f1e8e7)

[checkpoint: 3f1e8e7] — 验证报告挂 refs/notes/verification;CI=true pnpm check 全绿(487,+80 用例)+ CI=true pnpm e2e 18 过回归;自治验收(编排代行)。

## Phase B: 定义入事件日志与 _meta 站点

- [x] Task: 定义 seed 迁移(boot:日志无定义→三 flow machine-as-JSON 入日志;fold 出活跃定义供引擎;代码常量降级为 seed 源)(TDD:fold 定义=B1–B3 行为不变) (a1d7e63)
- [x] Task: /_meta 端点(well-known/entity/exec 同引擎 rel 前缀路由;业务 sitemap 排除 _meta)(TDD) (45fa459)
- [x] Task: 在途实例出生版本戳(激活不迁移在途;实例按出生定义走完)(TDD) (19f877c)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase C: 激活队列、机械 diff 与 BIOS 最小面

- [ ] Task: activation 实体投影(checks/diff/artifact)+ deep-object-diff 集成(TDD:diff 是纯数据)
- [ ] Task: BIOS 页三面(meta/flows 定义查看、激活队列+react-diff-view 渲染+approve/reject[RJSF]、meta/self)(组件测试:diff 零 AI 内建渲染;approve 按钮 actor=human)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)

## Phase D: S2 全链路 E2E

- [ ] Task: S2 E2E(agent 非法定义拒→修正→submit→pending→human BIOS approve→sitemap bump→agent 零 prompt 用新动作 pin;meta approve 拒 agent;在途实例;重放含定义事件;回归 B/S1)
- [ ] Task: Phase Verification & Checkpoint(Refer to workflow.md)
