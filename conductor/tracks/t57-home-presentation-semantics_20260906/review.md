# T57 实现交叉 Review（合并前）

范围：bf58603d → T57 worktree；交叉review者creation/governance检查其他人的改动，主agent复核与修复。
这不是最终合并验收；重度/浏览器/模型按用户授权留主仓库集成后。

| Finding                         | 影响                    | 修复/回归                                                           |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| R1 概览字段被row遗漏            | 合同字段不再可见        | 恢复声明overview值，row回归通过                                     |
| R2 entities空/证据子项误判group | 隐藏对象自身责任        | 只有显式groupRole＋members构成group，UI与coverage对齐；相关用例通过 |
| R3 unknown认知抛错              | 未知应用不可读          | 解析失败安全回退，保留身份/动作；负例通过                           |
| R4 首页focusquery未实际呈现     | 人机上下文不同          | route首页先取共享根声明，query不冒充所见；client-view回归通过       |
| R5 原始状态/重复resume          | 首页噪声与可读性        | 使用声明status字段；无active不发resume；纯投影回归通过              |
| R6 新开窗入口焦点丢失           | 键盘跳到FAB             | 捕获真实opener，断开后回退FAB；真实组件回归通过                     |
| R7 无字段确认Escape被忽略       | Dialog选项却无modal接管 | 仅实际表单dialog跳过inline Escape；Red复现→Green                    |
| R8 决定完成后receipt降级        | 同一主面丢结果解释      | 责任/决定历史保持声明语义，no-action仍保留决定词；18项回归通过      |

创建原文/owner/幂等与client参数防伪造经独立review未发现新的阻断；D78.4既有边界未声称修复。
范围内新增接口、catalog与策略更新已记录D79。最终合并diff、运行与视觉仍待复审。
