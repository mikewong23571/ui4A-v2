/**
 * 真实 walkthrough 制品的 meta scope 披露切片 wire 预算(T31 R16)。
 *
 * packages/agent/src/llm/prompt-budget.test.ts 的 32 KiB decide 预算用合成
 * 夹具验证预算与 scope 隔离;本套件补上「真实切片」链路——从内置应用制品
 * 出发,经生产的每一环到达 prompt 披露形态,并断言序列化字节数 ≤ 32 KiB:
 *
 * bundle 注册(parseApplicationBundle)→ 生产 sitemap 投影(engine
 * deriveSitemap)→ 合同读端窄化解析(agent createContractClient.getSitemap,
 * 即 /.well-known/ui4a.json 的 HTTP 读取路径)→ scope 披露切片(agent
 * sliceSitemapDisclosure,prompt 中的 sitemap 段即此形态、含缩进序列化)。
 *
 * governance application 是定义治理(meta 面)交互的家:其切片必须非空
 * (flows/capabilities 在场)且不携带 capability schema(披露纪律);超预算
 * 时本测试如实红——不允许放宽预算或裁剪内容求绿(R16 验收信号)。
 */
import { Buffer } from 'node:buffer';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createContractClient,
  sliceSitemapDisclosure,
  type FetchLike,
  type SitemapSummary,
} from '@ui4a/agent';
import { deriveSitemap, parseApplicationBundle } from '@ui4a/engine';

import artifact from './ui4a-walkthrough.bundle.json';

const DECIDE_WIRE_BUDGET_BYTES = 32 * 1024;

/** 实测字节记录(afterAll 打印,便于规模漂移的日常观察)。 */
const measurements: { name: string; prettyBytes: number; compactBytes: number }[] = [];

function utf8Bytes(value: unknown): number {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.byteLength(serialized, 'utf8');
}

/** 走完整生产链:制品 → sitemap 投影 → 合同读端窄化解析(HTTP 同形)。 */
async function summaryFromWire(): Promise<SitemapSummary> {
  const bundle = parseApplicationBundle(artifact);
  expect(bundle.applications.map((application) => application.name)).toContain('governance');

  const derived = deriveSitemap(bundle.flows, {
    applications: Object.fromEntries(
      bundle.applications.map((application) => [application.name, application]),
    ),
    capabilities: Object.fromEntries(
      bundle.capabilities.map((capability) => [capability.name, capability]),
    ),
  });

  // getSitemap 读的是 /.well-known/ui4a.json 响应体:同形走一遍真实读端
  // 解析(窄化/丢弃未知字段),不手工构造 SitemapSummary。
  const fetchImpl: FetchLike = async () =>
    new Response(JSON.stringify(derived), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const summary = await createContractClient('http://contract.test', fetchImpl).getSitemap();
  expect(summary).toBeDefined();
  return summary!;
}

describe('真实 walkthrough 制品的 meta scope 披露切片 wire 预算(T31 R16)', () => {
  it('governance(meta)scope 切片 ≤ 32 KiB,且 flows/capabilities 关键 section 非空', async () => {
    const summary = await summaryFromWire();

    // 当前 rel 属于 governance flow 面(scope 判定的兜底来源之一)。
    const currentRel = 'flow:agent-definition-authoring';
    const sliced = sliceSitemapDisclosure(summary, {
      scope: 'governance',
      currentRel,
    });

    // 非空切片证明真的接入了真实制品,不是空壳满足预算。
    expect(sliced.applications.map((application) => application.name)).toEqual(['governance']);
    const governanceFlows = sliced.applications[0]!.flows.map((flow) => flow.name);
    expect(governanceFlows).toContain('agent-definition-authoring');
    expect(sliced.surfaces.some((surface) => surface.rel === currentRel)).toBe(true);
    expect((sliced.capabilities ?? []).map((capability) => capability.name)).toContain(
      'agent-definition.author',
    );

    // 披露纪律:prompt 视图不携带 capability schema。
    const serialized = JSON.stringify(sliced, null, 2);
    expect(serialized).not.toContain('inputSchema');
    expect(serialized).not.toContain('outputSchema');
    const prettyBytes = utf8Bytes(serialized);
    measurements.push({
      name: 'walkthrough meta/governance scope 切片',
      prettyBytes,
      compactBytes: utf8Bytes(JSON.stringify(sliced)),
    });
    expect(prettyBytes).toBeLessThanOrEqual(DECIDE_WIRE_BUDGET_BYTES);
  });

  it('非 scope 条目按披露口径降为导航入口(rel + title),不随行复制', async () => {
    const summary = await summaryFromWire();
    const sliced = sliceSitemapDisclosure(summary, {
      scope: 'governance',
      currentRel: 'flow:agent-definition-authoring',
    });
    const foreignSurfaces = sliced.surfaces.filter(
      (surface) => surface.rel === 'flow:post-status' || surface.rel === 'flow:writing-request',
    );
    expect(foreignSurfaces.length).toBeGreaterThanOrEqual(2);
    for (const surface of foreignSurfaces) {
      expect(Object.keys(surface).sort()).toEqual(['rel', 'title']);
    }
  });
});

afterAll(() => {
  process.stdout.write(`real bundle meta scope bytes ${JSON.stringify(measurements)}\n`);
});
