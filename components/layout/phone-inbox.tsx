"use client";

import { usePathname } from "next/navigation";
import { Inbox } from "@/components/icons";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { useUnreadActivity } from "@/components/layout/activity-bell";
import Link from "@/components/navigation/nav-link";
import { emitNavigationEvent } from "@/lib/navigation/analytics";
import { PHONE_INBOX, placeOf } from "@/lib/navigation/phone";
import { cn } from "@/lib/utils/cn";

/**
 * Inbox in the top bar, below `lg`: a cell beside search, at the bar's end,
 * where the bell stands on a desktop. It opens `/inbox` — approvals answered
 * in their row, then alerts — and carries the bell's unread count (the bell
 * stays mounted but undrawn below `lg`, and keeps the count current). Marked
 * with a gold line under it while you are in Inbox, Approvals or Activity.
 */
export function PhoneInbox() {
  const t = useTranslations("shell");
  const current = placeOf(usePathname()) === "inbox";
  const unread = useUnreadActivity();
  const count = unread && unread > 0 ? unread : null;
  return (
    <Link
      href={PHONE_INBOX}
      navSource="mobile"
      intent
      aria-current={current ? "page" : undefined}
      aria-label={count ? `${t("phone.inbox")}, ${t("phone.inboxCount", { count })}` : t("phone.inbox")}
      data-testid="phone-inbox"
      onNavigate={() => emitNavigationEvent("navigation_destination_opened", { module: "inbox", source: "phone_top_bar" })}
      className={cn(
        "relative grid w-14 shrink-0 place-items-center border-l border-line-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:hidden",
        current ? "text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-accent" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Inbox aria-hidden="true" className="size-5" />
      {count ? (
        <span aria-hidden="true" data-testid="phone-inbox-count" className="absolute left-[calc(50%+2px)] top-1.5 grid h-5 min-w-5 place-items-center bg-accent px-1 font-mono text-meta font-medium leading-none tabular-nums text-accent-fg">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
