"use client";

import Link from "next/link";
import { CloudOff, Loader2, RefreshCw, TriangleAlert, CheckCircle2 } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { cn } from "@/lib/utils/cn";

import { useOffline } from "./use-offline";

/**
 * The compact, persistent connectivity and sync indicator (MOB-09 §24, §25, §116).
 *
 * Quiet while online with nothing to send: it renders nothing then. It never
 * blocks the page and never stands alone on colour — every state has an icon and
 * words, and a screen reader hears the same sentence (§161). Tapping it opens
 * the Sync Center.
 */
export function OfflineStatus({ className, inShell = true }: { className?: string; inShell?: boolean }) {
  const t = useTranslations("offline");
  const state = useOffline();
  if (!state.ready || state.unsupported) return null;

  const { queue, unsynced, online } = state;
  const attention = queue.failed + queue.needsReview;
  const waiting = unsynced - attention;
  const paused = state.engine === "paused-auth" || state.engine === "paused-update" || state.engine === "identity-mismatch";

  let tone: "offline" | "attention" | "syncing" | "synced" | "waiting" | null = null;
  let text = "";
  if (!online) {
    tone = "offline";
    text = unsynced > 0 ? t("status.offlineWaiting", { count: unsynced }) : t("status.offline");
  } else if (paused) {
    tone = "attention";
    text = state.engine === "paused-auth" ? t("status.pausedAuth") : state.engine === "paused-update" ? t("status.pausedUpdate") : t("status.identityMismatch");
  } else if (attention > 0) {
    tone = "attention";
    text = t("status.attention", { count: attention });
  } else if (state.restore === "syncing" || state.engine === "syncing") {
    tone = "syncing";
    text = state.restore === "syncing" ? `${t("status.restored")} · ${t("status.syncing", { count: Math.max(1, waiting) })}` : t("status.syncing", { count: Math.max(1, waiting) });
  } else if (state.restore === "synced") {
    tone = "synced";
    text = t("status.allSynced");
  } else if (waiting > 0) {
    tone = "waiting";
    text = t("status.waiting", { count: waiting });
  }
  if (!tone) return null;

  const Icon = tone === "offline" ? CloudOff : tone === "attention" ? TriangleAlert : tone === "syncing" ? Loader2 : tone === "synced" ? CheckCircle2 : RefreshCw;
  return (
    // In the shell it floats under the sticky bars instead of taking a row, so showing or
    // clearing a sync never moves the page below it.
    <div
      className={cn(
        "flex justify-center",
        inShell && "pointer-events-none fixed inset-x-0 top-[calc(var(--nesto-shell-header-h)+var(--nesto-shell-breadcrumb-h)+0.5rem)] z-[var(--nesto-z-shell-breadcrumb)] px-4",
        className,
      )}
    >
      <Link
        href="/offline?view=sync"
        // A plain navigation: offline, the router's own fetch would fail; the service worker answers a real one.
        prefetch={false}
        data-testid="offline-status"
        data-tone={tone}
        role="status"
        aria-live="polite"
        title={tone === "offline" ? t("status.offlineHint") : t("status.openSyncCenter")}
        className={cn(
          "inline-flex min-h-8 max-w-full items-center gap-2 rounded-full border px-3 py-1 text-micro font-medium touch:min-h-11",
          inShell && "pointer-events-auto shadow-menu",
          tone === "offline" && "border-line-strong bg-surface-muted text-fg",
          tone === "attention" && "border-transparent bg-warning-soft text-warning-strong",
          (tone === "syncing" || tone === "waiting") && "border-transparent bg-info-soft text-info-strong",
          tone === "synced" && "border-transparent bg-success-soft text-success-strong",
        )}
      >
        <Icon className={cn("size-3.5 shrink-0", tone === "syncing" && "animate-spin")} aria-hidden />
        <span className="truncate">{text}</span>
      </Link>
    </div>
  );
}
