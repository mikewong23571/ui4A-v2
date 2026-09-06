'use client';
import Link from 'next/link';
import { Button } from '../ui/button';
/** Entry controls open the existing session or the canonical contract creation surface. */
export function HomeEntry() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        data-nav="local:home-chat"
        onClick={(event) =>
          window.dispatchEvent(new CustomEvent('ui4a:chat-open', { detail: event.currentTarget }))
        }
      >
        与助手讨论
      </Button>
      <Link
        href="/canvas?focus=threads"
        data-nav="local:home-create"
        className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
      >
        发起工作
      </Link>
      <Link
        href="/canvas?focus=threads-history"
        data-nav="local:home-history"
        className="text-sm text-muted-foreground hover:underline"
      >
        已结束的工作
      </Link>
    </div>
  );
}
