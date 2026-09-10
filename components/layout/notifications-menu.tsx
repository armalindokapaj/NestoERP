"use client";

import { Bell } from "lucide-react";

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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover"
        aria-label="Notifications"
      >
        <Bell aria-hidden="true" className="size-[18px]" />
        {/* §33: the bell carries a dot so the panel has a reason to be opened. */}
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 size-1.5 rounded-full bg-accent ring-2 ring-surface"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <div className="px-2.5 pb-3 pt-1">
          <p className="text-table text-fg-muted">You have no notifications.</p>
          <p className="mt-1 text-meta text-fg-subtle">
            Notifications arrive with the activity engine in a later version.
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
