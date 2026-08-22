/**
 * 入口页壳(首页,T2 Phase F)。
 *
 * 壳只挂页面级实体缓存承载(T12 Phase B:EntityCacheProvider,生命周期 =
 * 本页——同页多消费方共享同一 PageEntityCache,跨页面不共享);态势投影、
 * 骨架导航与取数状态机在 HomeBody(组件级可测,见 components/home-body.tsx)。
 */
import { EntityCacheProvider } from '@/components/entity-cache-provider';
import { HomeBody } from '@/components/home-body';

export default function Home() {
  return (
    <EntityCacheProvider>
      <HomeBody />
    </EntityCacheProvider>
  );
}
