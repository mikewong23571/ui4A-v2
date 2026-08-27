# Track: T32 交互与组合质量修复:T28/T30 实现质量发现项登记与修复

把 2026-08-27 T28/T30 两个已归档 track 的实现质量评审发现登记成册
(2 medium、1 裁决、4 low 行为、3 卫生、4 归后续,编号 Q1–Q14)
并集中修复:medium 测试缺口补齐且 mutation 抽查能红,裁决项落
DECISIONS(D49),low 逐项修复,归后续项落注;并承接 T31 因 T28 归档
而失去归属的 R23/R25(本 Track Q3/Q4/Q5)。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)

当前状态:`new`。性质:fix(只修不建)。修复对象 T28/T30 已归档;T31 在途
(Q6/Q7 与其 R12 同文件,执行序见 plan 头注)。评审结论:两 track 验收声明
成立、红线无实质违反。登记册与修复方案见 spec.md"发现项登记册";实施会话
从 spec.md 起步即可。
