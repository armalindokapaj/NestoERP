"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils/cn";

/**
 * A record's action sheet (MOB-03 §34, MOB-04 §79): a 44px `...` button that
 * opens a bottom sheet titled with the record. The page passes only the
 * actions this person may take (`SheetActionLink`, `SheetActionButton`), and
 * the server authorizes each again when it runs. Choosing an action closes the
 * sheet; a destructive one goes last, in danger colour, and should open its own
 * confirmation.
 */
export function RecordActionSheet({ name, children }: { name: string; children: React.ReactNode }) {
  const t = useTranslations("ui");
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={trigger}
        label={t("recordActions", { name })}
        icon={<MoreHorizontal aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="record-actions"
      />
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={name}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        {/* Any link or action button inside closes the sheet once it has been pressed. */}
        <div role="group" aria-label={t("actions")} className="-mx-1 flex flex-col" onClick={(event) => {
          if ((event.target as HTMLElement).closest("[data-sheet-action]")) setOpen(false);
        }}>
          {children}
        </div>
      </BottomSheet>
    </>
  );
}

const actionClass = "flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-body font-medium text-fg hover:bg-hover disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-fg-subtle";

export function SheetActionLink({ href, icon, children }: { href: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} data-sheet-action className={actionClass}>
      {icon}
      {children}
    </Link>
  );
}

export function SheetActionButton({
  onSelect,
  icon,
  destructive = false,
  disabled,
  children,
}: {
  onSelect: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-sheet-action
      data-variant={destructive ? "danger" : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(actionClass, destructive && "mt-1 border-t border-line pt-1 text-danger-strong [&_svg]:text-danger-strong")}
    >
      {icon}
      {children}
    </button>
  );
}
