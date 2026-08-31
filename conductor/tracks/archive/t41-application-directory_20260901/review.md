# T41 验证与边界

## 设计审查

- 用户明确要求首页最多 9 个，已写入 D57、组件预算和 30 应用回归；不是安装上限。
- 目录与缩略共用 reader、成员过滤、链接组件；未知合法应用通过合同数据进入，无逐应用分支。
- 没有创建新的业务 entity、event、数据库表、偏好存储、LLM 路由或 Application workspace。
- 首页用途退居 native tooltip，完整用途可在目录读取；全站新增一个固定“应用”入口。
- homepage → directory 保留显式 scope/thread 与安全 returnTo；directory → landing 复用既有路径。
- 源码治理覆盖提取后的 reader/link/directory，避免抽包后绕开禁止固定应用清单的检查。
- 640px 几何探针发现定高顶栏裁切导航，已先记录 Red 再允许顶栏按空间自然换行。

## 验证证据

- 聚焦 Vitest：8 文件 / 32 测试通过（reader、目录、缩略、导航、首页壳、源码治理）。
- `pnpm exec playwright test e2e/interaction/application-directory.spec.ts --workers=1`：5/5。
  390/640/768/1512px 各自验证 7→30 应用：主页 7→9，目录 30，书架高度不增长，
  无横向溢出，顶栏不裁切，键盘进入目录，搜索/清除，保留上下文的 landing href。
- 第 5 项 E2E 从实际授权 HTTP sitemap 比对全部目录 title/intent，再进入真实应用 Surface。
- Browser 人工等效走查：首页缩略、640px 顶栏、目录宽/窄、待办搜索及清除。
- 截图：[首页宽屏](./evidence/home-1512.png)、[首页 640px](./evidence/home-640.png)、
  [目录宽屏](./evidence/directory-1512.png)、[目录窄屏](./evidence/directory-390.png)。
- [30 应用 fixture：首页仅前 9 个](./evidence/home-30-apps.png)（合成数据，不代表部署应用清单）。
- 全量 check 与原首页常驻 E2E 的最终结果在 plan.md 中登记。

## 交付边界

既有未提交的 Meta dashboard 样式/标题/测试改动保留，不属于本 Track 提交。
不推送、不部署、不安装新依赖；不把合成 30 应用写入真实应用定义。
