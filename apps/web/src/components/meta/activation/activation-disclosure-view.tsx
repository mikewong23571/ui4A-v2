'use client';
/**
 * 批准者本人的激活可见性披露回执(D70.1,T51):渲染 meta exec approve 响应携带的
 * disclosure,三分支——立即可见(去应用目录)/刷新授权后可见(一键走既有登录)/
 * 需 IdP 授予(两条已裁定路径 + 我的授权出口,US7)。零 AI、纯机械文案;
 * undefined 时不渲染任何东西(parser 已在 meta-client 拒绝 malformed)。
 */
import { Badge } from '@/components/ui/badge';

import type { ActivationDisclosureView } from './activation-disclosure';

export function MetaActivationDisclosure({
  disclosure,
}: {
  disclosure: ActivationDisclosureView | undefined;
}) {
  if (disclosure === undefined) return null;
  const names = disclosure.applications.map((entry) => entry.application);
  const needsRelogin = disclosure.applications.some(
    (entry) => entry.outcome === 'visible-after-relogin',
  );
  const needsGrant = disclosure.applications.some(
    (entry) => entry.outcome === 'requires-idp-grant',
  );

  return (
    <section
      aria-label="激活可见性披露"
      data-testid="activation-disclosure"
      className="space-y-2 rounded-lg border bg-muted/20 p-4 text-sm"
    >
      <h3 className="font-semibold">安装结果与你的会话授权</h3>
      <p className="flex flex-wrap items-center gap-1.5">
        <span>新装应用:</span>
        {names.map((name) => (
          <Badge key={name} variant="outline">
            {name}
          </Badge>
        ))}
      </p>
      {!needsRelogin && !needsGrant && (
        <p>
          已对当前会话可见——
          <a
            href="/applications"
            data-nav="local:disclosure-applications"
            className="text-primary underline underline-offset-4"
          >
            前往应用目录
          </a>
          现在就能进入。
        </p>
      )}
      {needsRelogin && (
        <p>
          已装入,但当前会话授权未包含它;刷新授权后可见。
          <a
            href="/auth/login?returnTo=/applications"
            data-nav="local:disclosure-refresh"
            className="ml-1 text-primary underline underline-offset-4"
          >
            刷新授权
          </a>
        </p>
      )}
      {needsGrant && (
        <div className="space-y-1">
          <p>
            已装入,但当前会话授权与其无交集,且刷新授权无法解决。需要管理员执行其一:
            在部署配置的浏览器登录范围加入治理词(ui4a:policy:governance,
            见 DEPLOYMENT 文档「授权面」),或在身份源为该应用配置逐 app 授权。
          </p>
          <a
            href="/session"
            data-nav="local:disclosure-session"
            className="text-primary underline underline-offset-4"
          >
            查看我的授权
          </a>
        </div>
      )}
    </section>
  );
}
