# T51 验收证据 — 2026-09-04

> 自治验收(workflow.md 自治编排协议;审批点由编排 agent 代行,验证证据见各
> commit git notes)。部署站浏览器门复核留待用户按 DEPLOYMENT 标准流程发布后裁定
> (§7 已新增授权类变更的浏览器通道强制步骤)。

## 用户故事 → 测试 → 命令映射

| 故事 | 证据 | 命令 |
| --- | --- | --- |
| US1 批准即知晓 | `auth/activation-disclosure.test.ts`(11 组:三分支/混合/生长语义/防御);`api/meta/exec/route.activation-disclosure.test.ts`(6 组:治理展开 exec 前授予集合不含新 app 仍 immediately-visible、relogin、IdP、空 diff、非 approve、rejected);`e2e/t51-visibility-recovery.spec.ts`(真实浏览器:approve→披露回执→目录可见) | `pnpm vitest run apps/web/src/auth/activation-disclosure.test.ts apps/web/src/app/api/meta/exec/`;`CI=true pnpm e2e e2e/t51-visibility-recovery.spec.ts` |
| US2 我的授权面板 | `api/auth/session/route.production-auth.test.ts`(4 组:非治理不泄露全集/治理展开回显/local/401);`components/session/session-panel.test.tsx`(4 组);`site-nav.test.tsx` 菜单断言;edge 白名单 `scripts/t22/compose/t22-compose-hardening.test.ts` declared-surface 23/23 | `pnpm vitest run apps/web/src/app/api/auth/ apps/web/src/components/session/ apps/web/src/components/site-nav.test.tsx scripts/t22/compose/t22-compose-hardening.test.ts` |
| US3 刷新授权 | 面板/披露组件断言 `/auth/login?returnTo=…`(D70.4 复用 beginLogin,零新后端);e2e 步骤 4 反向断言 local 无刷新动作 | 同上 |
| US4 措辞诚实 | `situation-bar.test.tsx`/`meta-dashboard.test.tsx`/`application-directory.test.tsx` 措辞与空态出口断言;发现文档过滤零变化由 check 全量回归背书 | `pnpm vitest run apps/web/src/components/` |
| US5 人机同门一致 | 防回归锚:CLI 零改动(本 track diff 不含 apps/cli);`grantedPolicyScopes` 同源推导,request-identity 单测族在 check 全量内 | `git diff --stat b9ad3fc9..HEAD -- apps/cli`(空) |
| US6 运维验收合同 | `DEPLOYMENT.local.md` §7 新增授权类变更浏览器通道复核 + `/auth/login` scope 参数匿名检查 + edge 白名单生效步骤(git-excluded 本地文件,不入 commit) | 人工核对文档 |
| US7 授予路径可发现 | `activation-disclosure-view.test.tsx` IdP 分支双路径文案断言(治理词 settings 路径/逐 app IdP 路径) | `pnpm vitest run apps/web/src/components/meta/activation-disclosure-view.test.tsx` |

## 全量门禁(2026-09-04)

- `pnpm check`(含 governance:strict):**3934 passed / 15 skipped**(skips 为
  Temporal/真实 LLM 环境依赖,与基线同口径)。
- `CI=true pnpm e2e`:**69 passed / 34 skipped**(3.4m;Temporal 7235 缺位同口径)。
- `CI=true pnpm e2e invariants`:**13 passed / 14 skipped**。

## 过程要点(诚实记录)

1. **设计复审价值**:F1(edge 白名单)为阻断级——若无复审,`/session` 与
   `/api/auth/session` 将在部署站 404,重演「测试绿、人通道坏」。
2. **e2e 抓到真实缺陷**:披露初版误用 exec 前授予集合,治理/local 会话被判
   `requires-idp-grant`(81665704 修正:`sessionGrantsGrowWithInstalls`)。该缺陷
   在纯函数/路由单测下均「合理」——只有真实浏览器门暴露。
3. **并行协作**:T50 并行期间暂停过一次;P1 接线暂存 `/tmp/t51-p1-parking` 后
   恢复(T50 收口顺带修复了暂存 patch 中的 tsc 类型修正,冗余部分丢弃);
   e2e 用独立 `t51-*.spec.ts`,未触碰对方在改的 t48 spec。

## 恢复链路全景走查(spec §6)

本地浏览器门已闭环(e2e):起草→批准→披露回执(immediately-visible)→应用目录
出现新应用→「我的授权」面板自查一致。生产通道(真实 OIDC/SSO 刷新授权往返)按
合同属部署站复核,由用户发布后按 DEPLOYMENT §7 新步骤执行。
