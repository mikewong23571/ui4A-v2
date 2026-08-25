/** Next.js calls this once and awaits it before the server accepts requests. */
export async function register(): Promise<void> {
  // The standalone server may omit NEXT_RUNTIME; only an explicit Edge runtime lacks Node APIs.
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const { runWebProductionDeploymentPreflight } = await import('./production-deployment-preflight');
  const config = runWebProductionDeploymentPreflight();
  // production 部署的 LLM 合同在 settings/secrets 文件里(apiKeyRef 间接引用,preflight
  // 已强制存在);导出为 LLM_* 进程环境,供 packages/agent 的 resolveLlmConfig() 统一
  // 读取。显式预设的 LLM_* 优先(本地/测试覆盖),缺项不写入(undefined 会被
  // process.env 字符串化)。
  if (config !== undefined) {
    const { llm } = config.settings;
    const apiKey = config.secrets[llm.apiKeyRef];
    if (process.env.LLM_BASE_URL === undefined) process.env.LLM_BASE_URL = llm.baseUrl;
    if (process.env.LLM_MODEL === undefined) process.env.LLM_MODEL = llm.model;
    if (process.env.LLM_API_KEY === undefined && apiKey !== undefined) {
      process.env.LLM_API_KEY = apiKey;
    }
  }
}
