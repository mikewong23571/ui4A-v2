# Track: T32 交互与组合质量修复:T28/T30 实现质量发现项登记与修复

把 2026-08-27 T28/T30 两个已归档 track 的实现质量评审发现登记成册
(2 medium、1 裁决、4 low 行为、3 卫生、4 归后续,编号 Q1–Q14)
并集中修复:medium 测试缺口补齐且 mutation 抽查能红,裁决项落
DECISIONS(D49),low 逐项修复,归后续项落注;并承接 T31 因 T28 归档
而失去归属的 R23/R25(本 Track Q3/Q4/Q5)。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)

当前状态:`in_progress`(Phase A–D 闭环,D49 已落;Q1–Q10 全部终态:
修复 9 项 + Q3 经 D49 豁免;归后续 Q11–Q14 已登记)。**唯一待办**:
全量验收的 `pnpm check` 终绿受并行 T31 的 db 目录基线增长(其 R2,
bc8d881)在途影响——T31 闭环后复跑 `pnpm check` 并勾掉最后一项即可收尾
归档。性质:fix(只修不建)。登记册与修复方案见 spec.md"发现项登记册"。
