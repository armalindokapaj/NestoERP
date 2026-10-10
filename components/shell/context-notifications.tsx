"use client";

import * as React from "react";
import { Bell } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { topbarOffset } from "@/lib/layout/topbar-line";
import { usePanelOpen } from "@/lib/navigation/panel-host";

/**
 * The bell of a session that has no company membership (UI-01 §9.1, §13).
 *
 * Notifications are addressed to a company member, so a Platform Admin or a
 * group-only person has no inbox to read yet, and no event producer writes one.
 * The control still sits in the cluster, in the same place as everywhere else,
 * and says so honestly: no badge (an unknown count is never drawn as a number)
 * and an empty state naming the context it would filter by. When platform or
 * group events are persisted, this is the one component that starts reading them.
 */
export function ContextNotifications({ context }: { context: string }) {
  const t = useTranslations("shell");
  const [open, setOpen] = usePanelOpen("activity");
  const trigger = React.useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          aria-label={t("account.notificationsPanel")}
          aria-haspopup="dialog"
          data-testid="notification-bell"
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell aria-hidden className="size-5" strokeWidth={1.6} />
        </button>
      </PopoverTrigger>
      {/* Its top edge on the breadcrumb bar's top line, like every panel opened from the top bar. */}
      <PopoverContent align="end" sideOffset={open ? topbarOffset(trigger.current) : undefined} aria-label={t("account.notificationsPanel")} className="w-[400px] max-sm:w-[calc(100vw-1.5rem)]" data-testid="activity-panel">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-card font-semibold text-fg">{t("account.notificationsPanel")}</h2>
          <p className="mt-0.5 text-meta text-fg-muted" data-testid="notification-context">{t("account.notificationsContext", { context })}</p>
        </div>
        <div role="status" className="px-4 py-8 text-center">
          <p className="text-table font-medium text-fg">{t("account.notificationsEmpty")}</p>
          <p className="mt-1 text-meta text-fg-muted">{t("account.notificationsEmptyHint")}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
