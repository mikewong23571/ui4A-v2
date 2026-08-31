/** Transport failure is not an empty authorized catalog. */
export function CatalogError({ retry }: { retry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
    >
      <span>应用目录读取失败，请重试。</span>
      <button
        type="button"
        data-nav="local:applications-retry"
        onClick={retry}
        className="shrink-0 rounded-md border px-3 py-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        重试
      </button>
    </div>
  );
}
