"use client";

import { Bell } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Notifications are a visual placeholder in V0.1 (spec §11). The trigger and
 * panel exist so the notification engine has somewhere to land in V0.3.
 */
export function NotificationsMenu() {
  const t = useTranslations("shell");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative grid size-9 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover"
        aria-label={t("notifications")}
      >
        <Bell aria-hidden="true" className="size-[18px]" />
        {/* §33: the bell carries a dot so the panel has a reason to be opened. */}
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 size-1.5 rounded-full bg-accent ring-2 ring-surface"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("notifications")}</DropdownMenuLabel>
        <div className="px-2.5 pb-3 pt-1">
          <p className="text-table text-fg-muted">{t("noNotifications")}</p>
          <p className="mt-1 text-meta text-fg-subtle">{t("notificationsLater")}</p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
