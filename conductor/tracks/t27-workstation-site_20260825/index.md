# Track: T27 Workstation 站点:三种工作形态落地与"我的事"首页

把站点作为天然分割点坐实:workstation(家,默认落点)/ meta(工具间,既有)
/ raw(验钞灯,模式非站点)。首页从零件清单改为"我的事"——什么在等我、
什么在动、上次停在哪;scope 声明常显。内容面全部经 presentation 机器,
零硬编码页面。

- [Metadata](./metadata.json)
- [Specification](./spec.md)
- [Plan](./plan.md)

当前状态:`planned`。方向依据:`conductor/product-vision.md` §二(入口论)、
§三(工作形态/workstation 不硬编码)、§五(加减法)、§六(页面滑梯)、
§八(装配单点)。依赖 T24(呈现诚实化)、T26(工作线投影)、T29(在场与处境)
与 T30(呈现组合化——内容面承载机),四者均已闭环归档。

2026-08-26 细化:spec 补齐方向依据(北极星 §二/§三/§五/§六/§八)、五个前序
track 的落地事实与代码锚点(T30 组合机器与 my-work 三区域声明、T26 threads
投影与动作面、T29 presence/situation/clientView 链路、T24 抽屉口径、T25
起点链边界)、现状事实(15 路由清单/SiteNav 六项/home-body 六区块退役对象/
canvas 宿主取数链/GR3 基线与预留收缩窗口/I3·I5·I7 锚点)、Phase A spike 五问
(首页落地形态、处境常显与显式声明、站点命名与 presence site 值域、导航折叠
形态、跨站桥推导规则,产出 D46);新增 plan.md(Phase A spike → B 误导验收
前置迁移 → C 站点壳与三形态导航 → D 首页落地 → E 处境常显与双桥 → F 验收
收尾)。误导性验收排查复核修正:human.spec.ts:160/:169 与
dual-executor.spec.ts:240/:247 实为零件页导航(不随首页迁移)、
human.spec.ts:263 引用失效(全文 190 行);新增 home.test.tsx 整文件重写项。
实施会话无需此前聊天上下文,从 spec.md 起步即可。
