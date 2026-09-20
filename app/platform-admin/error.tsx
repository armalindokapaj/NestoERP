"use client";

import { Button } from "@/components/ui/button";

export default function PlatformAdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="nesto-card mx-auto max-w-2xl p-8 text-center"><h1 className="text-page font-semibold text-fg">The control plane could not load</h1><p className="mt-2 text-body text-fg-muted">The request failed before the page was ready. Retry it; if it continues, inspect System Health and the audit trail.</p><Button className="mt-5" onClick={reset}>Retry</Button></section>;
}
