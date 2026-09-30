"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";

/**
 * An explicit refresh for a list (MOB-03 §64). It re-runs the page's server
 * query for the same URL, so filters, sort and page stay, and no fake
 * animation stands in for data: the spinner runs while the transition does.
 * A future native shell can map pull-to-refresh to the same call.
 */
export function ListRefresh({ className }: { className?: string }) {
  const t = useTranslations("ui");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      disabled={pending}
      aria-label={pending ? t("refreshing") : t("refresh")}
      onClick={() => startTransition(() => router.refresh())}
      data-testid="list-refresh"
    >
      <RefreshCw aria-hidden="true" className={pending ? "animate-spin motion-reduce:animate-none" : undefined} />
      <span className="max-sm:sr-only">{t("refresh")}</span>
    </Button>
  );
}
