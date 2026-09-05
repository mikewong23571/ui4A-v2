'use client';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { useMetaEntity, useMetaSitemap, type MetaSitemapState } from './meta-client';
import type { MetaNavigationContext } from './meta-navigation';
import { withMetaNavigationContext } from './meta-navigation';
import { MetaReceiptProvider, useMetaReceiptFor } from './renderers/meta-receipt';
import { MetaEntityRenderer } from './renderers/meta-entity-renderer';
import { MetaActionOutcome } from './renderers/meta-action-outcome';

function LoadingContract() {
  return (
    <div aria-label="正在加载合同" className="space-y-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/** 目录/返回出口(G02b:不靠持续重试重取已不可访问的实体)。 */
function EntityExits({ navigation }: { navigation: MetaNavigationContext }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <a
        className="rounded-md border px-3 py-2 text-sm text-primary hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        href={
          withMetaNavigationContext(
            `/meta/entity?rel=${encodeURIComponent('meta/applications')}`,
            navigation,
          ) ?? `/meta/entity?rel=${encodeURIComponent('meta/applications')}`
        }
        data-nav="meta:exit:applications"
      >
        应用目录
      </a>
      <button
        type="button"
        className="rounded-md border px-3 py-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={() => window.history.back()}
      >
        返回上一页
      </button>
    </div>
  );
}

/**
 * G02b(T54/D73):稳定回执宿主——实体读取失败不丢失刚执行成功的事实;
 * 明确标注为历史结果，不以成功快照冒充当前授权事实。
 */
function StableReceipt({ rel }: { rel: string }) {
  const receipt = useMetaReceiptFor(rel);
  if (receipt === null) return null;
  return (
    <section
      role="status"
      aria-label="此前动作回执(历史结果)"
      className="space-y-2 rounded-md border bg-muted/20 p-4"
    >
      <p className="text-sm font-medium">此前动作的回执（历史结果，不代表当前仍可访问）</p>
      <MetaActionOutcome entity={receipt.outcome} caption="已执行(历史回执)" />
    </section>
  );
}

/**
 * 实体不可达的分型卡(D73.4):停用 / 无权限 / 服务故障三态,不得混为一谈;
 * 每种状态都保留稳定回执与出口。
 */
function EntityUnavailableCard({
  rel,
  title,
  description,
  navigation,
  extra,
}: {
  rel: string;
  title: string;
  description: string;
  navigation: MetaNavigationContext;
  extra?: string;
}) {
  return (
    <div className="space-y-4">
      <Card role="alert" className="border-destructive/40 p-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {extra !== undefined && <p className="mt-1 text-sm text-muted-foreground">{extra}</p>}
        <EntityExits navigation={navigation} />
      </Card>
      <StableReceipt rel={rel} />
    </div>
  );
}

function MetaEntityResource({
  rel,
  navigation,
  sitemap,
}: {
  rel: string;
  navigation: MetaNavigationContext;
  sitemap: NonNullable<MetaSitemapState['sitemap']>;
}) {
  const { entity, state, errorCode } = useMetaEntity(rel, navigation.scope, sitemap.version);
  // 回执宿主常驻(loading/ready/missing/error 各态之间不卸载):成功回执的生命
  // 周期独立于下一次实体读取(G02b)。
  return (
    <MetaReceiptProvider>
      {state === 'loading' ? (
        <LoadingContract />
      ) : state === 'missing' ? (
        <EntityUnavailableCard
          rel={rel}
          title="合同不存在或当前视角下定位失败"
          description="检查链接；当前视角已保留，但不会改变权限。跨 principal 资源仍按不存在处理。"
          navigation={navigation}
        />
      ) : state === 'error' || entity === null ? (
        errorCode === 'application_deprecated' ? (
          <EntityUnavailableCard
            rel={rel}
            title="应用已停用,不再可访问"
            description="该应用已受治理停用，相关合同与实体退出可访问面；事件日志保留审计。"
            extra="此处不再提供重试读取；如需相关业务请经治理渠道。"
            navigation={navigation}
          />
        ) : errorCode === 'scope_insufficient' ? (
          <EntityUnavailableCard
            rel={rel}
            title="当前授权无权访问此合同"
            description="访问权限来自登录凭证的授权集合；本次读取被结构化拒绝，不是服务故障。"
            extra="可返回目录，或经「我的授权」刷新授权后再试。"
            navigation={navigation}
          />
        ) : (
          <EntityUnavailableCard
            rel={rel}
            title="读取合同失败"
            description="服务不可用或返回了无法解释的失败。当前 URL 与审查现场已保留,可以刷新恢复。"
            navigation={navigation}
          />
        )
      ) : (
        <div data-testid="meta-content-ready">
          <MetaEntityRenderer
            rel={rel}
            entity={entity}
            navigation={navigation}
            descriptorTitle={sitemap.surfaces.find((surface) => surface.rel === rel)?.title}
          />
        </div>
      )}
    </MetaReceiptProvider>
  );
}

export function MetaEntityPage({
  rel,
  navigation,
}: {
  rel: string;
  navigation: MetaNavigationContext;
}) {
  const { sitemap, state } = useMetaSitemap(navigation.scope);
  if (state === 'loading') return <LoadingContract />;
  if (state === 'error' || sitemap === null) {
    return (
      <Card role="alert" className="border-destructive/40 p-6">
        <h1 className="text-xl font-semibold">读取授权 Meta sitemap 失败</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          服务不可用。当前视角与 URL 已保留,可以刷新恢复。
        </p>
      </Card>
    );
  }
  return <MetaEntityResource rel={rel} navigation={navigation} sitemap={sitemap} />;
}
