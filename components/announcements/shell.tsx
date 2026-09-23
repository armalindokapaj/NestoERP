"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TriangleAlert, X } from "lucide-react";

import { announcementApi } from "./announcement-api";

/**
 * The announcement layer in the app shell (PRD #45 §67, §68, §121-§124).
 *
 * Unread announcements are counted by the one bell (Activity Center §10); the
 * shell adds one banner, only for a critical announcement still
 * waiting on them: dismissible when it asks for no acknowledgment, otherwise
 * there until they acknowledge it. Never a stack.
 */

export function CriticalAnnouncementBanner({ banner }: { banner: { id: string; title: string; requiresAcknowledgment: boolean; href: string } | null }) {
  const pathname = usePathname();
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  if (!banner || dismissed === banner.id || pathname === banner.href) return null;

  return (
    <div role="alert" className="border-b border-danger/25 bg-danger-soft/70 px-4 py-2.5 md:px-6 xl:px-8" data-testid="critical-announcement-banner">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-danger-strong" />
        <p className="min-w-0 flex-1 truncate text-table text-danger-strong">
          <span className="font-semibold">Critical announcement:</span> {banner.title}
        </p>
        <Link href={banner.href} className="shrink-0 text-table font-semibold text-danger-strong underline underline-offset-2">
          {banner.requiresAcknowledgment ? "Read and acknowledge" : "Read"}
        </Link>
        {banner.requiresAcknowledgment ? null : (
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-danger-strong hover:bg-danger/10"
            onClick={() => {
              setDismissed(banner.id);
              // Dismissing an announcement that asks nothing more is having seen it.
              void announcementApi(`/api/announcements/${banner.id}/read`, { body: {} }).catch(() => undefined);
            }}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
