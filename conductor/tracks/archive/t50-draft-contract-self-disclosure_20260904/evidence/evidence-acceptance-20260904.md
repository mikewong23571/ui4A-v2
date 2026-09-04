# T50 验收记录 — 2026-09-04

环境:dev server 3100(local demo);生产合同形状同源(注解由同一 views 装配)。

## 机械自足证明(US1/F2)

- e2e(`e2e/cli-meta-drafts.spec.ts` 新增 2 例):`drafts schema --kind application-bundle` 输出与服务端合同注解**逐字节等值**(直连 `/_meta/api/entity` 对照);从输出 example **仅做字符串替换**(固定名→随机名,结构零改动)构造 payload → **一次 create 即 ready**。
- 步数对照:**1 次迭代**(基线:ui4a-ops 2026-09-04 实录 12 次 Draft 版本 + 5 种 seed 形状盲测 + 1 次人工越级询问)。
- 防漂移不变量(fixture 回环):派生 schema 结构化接受全部四个已安装 bundle 工件副本(engine 单测)。

## 三门可见性(US2)

| 门 | 证据 |
|---|---|
| CLI/HTTP | 合同注解 kinds=[agent-definition, application-bundle, flow-definition],app-bundle 含 schema+example,payload 字段保持字节级 `{}`(现场 curl 断言);CLI `drafts schema` 输出等值(e2e) |
| chat 模型视图 | 工具 schema+observation 两处均 example-only(D69 附录剥离),meta-parity 3/3:模型视图含 example 不含 schema;**HTTP 同载荷重放含全量注解逐字节等值**(合同不窄化直接证据);第二次决策请求 20,926B < 32,000 断言(预算恢复) |
| 浏览器 | RJSF create 表单正常展开(textarea×3,截图 02),payload 控件零漂移(承重墙测试以真实 draftCreateAction 固定,actions/draft-payload-annotation.test.tsx 19/19) |

## 拒绝可行动(US3/D69.3)

- 形状类 issue 携带 `expected` 结构化数据 + 精确 path(如 seed.instances.<key>),机械 message 原文不变(payload-issues.test 12/12,含原文断言);
- 抛出式 parseApplicationBundle 公共行为零变化(40+ 突变族等价核验)。

## 守卫闭合(US4/D69.4)

- 前缀/大写/下划线 target:guard-failed + rejectionEvent 留痕;create 与激活重验同判;裸名回归绿。

## 愿景对齐评审(spec §6.2 四条)

1. 同一扇门:一份注解,CLI/HTTP 原样、chat 模型视图按 D69 附录收窄(§八 prompt 层窄化)、RJSF 忽略——三门消费同一合同;✅
2. 不窄化 HTTP 合同:重放断言全量注解;✅
3. 读一个实体替代学一个格式:`drafts schema` 一步 + example 派生一次 ready(步数对照);✅
4. 无文案滑梯:触及的错误面(payload-issues.ts/create.ts 守卫/剥离函数)grep 无友好模板拼接,message 原文断言在测试固定;✅

## 过程教训(入 git notes)

- governance 按 `git ls-files` 扫描,**未跟踪文件不可见**——验收纪律修正为 `git add` 后复跑(P3 fix 提交后显形 GR2/GR3 两项,已修复:中性词、测试移至功能归属 components/actions);
- RJSF 承重墙实证:注解入 payload 属性内部会令控件消失(isJsonProjectionField 精确匹配 `{}`),fields 顶层 `x-` 描述符为正确落位。
