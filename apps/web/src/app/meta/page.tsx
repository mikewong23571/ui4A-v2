/**
 * BIOS 首页(T4 Phase C;arch-brief §10 A.8):`_meta` 定义平面的内建 UI 入口。
 *
 * 路由口径:canonical API 恒 /_meta/*(rewrites 到内部 /api/meta/*);浏览器
 * 页面挂 /meta(App Router 的 `_` 前缀目录不可路由)——首页一行链接可达,
 * 业务站 sitemap 不携带 _meta(跨站规则:进入定义层必须显式意图)。
 * T4 最小三面:定义查看 / 激活队列+机械 diff+approve/reject / meta/self。
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BIOS · UI4A',
};

const FACES = [
  {
    href: '/meta/flows',
    title: '定义查看',
    description: 'meta/flows:全部 flow 定义(节点/动作/字段表格)',
  },
  {
    href: '/meta/activations',
    title: '激活队列',
    description: 'meta/activations:待批准的定义激活(机械 diff + checks + approve/reject)',
  },
  {
    href: '/meta/self',
    title: 'meta/self',
    description: 'definition-lifecycle 自身定义(引擎自举的状态机)',
  },
] as const;

export default function BiosIndex() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <nav className="mb-2 text-sm">
        <a href="/" data-nav="home" className="text-blue-600 hover:underline">
          ← 首页
        </a>
      </nav>
      <h1 className="text-2xl font-semibold text-zinc-900">BIOS(定义平面)</h1>
      <p className="mt-1 text-xs text-zinc-500">
        内建 UI:修自己的扳手不能是自己造的零件——diff 渲染零 AI,审批不委托。
      </p>
      <ul className="mt-6 space-y-2 text-sm">
        {FACES.map((face) => (
          <li key={face.href}>
            <a href={face.href} data-nav="meta-face" className="font-medium text-blue-600 hover:underline">
              {face.title}
            </a>
            <span className="ml-2 text-zinc-500">{face.description}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
