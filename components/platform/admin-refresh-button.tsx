"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/** Re-reads the page's server data on request; nothing polls (Dashboard PRD §52). */
export function AdminRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button variant="secondary" size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      <RefreshCw aria-hidden="true" className={cn(pending && "animate-spin")} />Refresh
    </Button>
  );
}
