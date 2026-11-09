"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { usePhone } from "@/components/layout/use-phone";
import Link from "@/components/navigation/nav-link";
import { PageMenuItems, useClaimPageMenu } from "@/components/navigation/page-menu";
import { RecordActionSheet, SheetActionButton, SheetActionLink } from "@/components/data/record-action-sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";

/**
 * An action a person may take on a record (MOB-04 §79, §80). The page builds
 * this list from canonical action resolution — permission, record state, module
 * activation — and passes only what the reader can actually do; nothing here
 * decides that, and the server authorizes again when the action runs. A
 * `transition` is a state-machine action: it must call the module's canonical
 * transition, never write a status.
 */
export type EntityAction = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  /** A link action (Edit, Download). */
  href?: string;
  /** A button action (Duplicate, Archive, a state transition). */
  onSelect?: () => void;
  /** Delete, Archive, Reject, Revoke: goes last, in danger colour; the caller opens its own confirmation. */
  destructive?: boolean;
  kind?: "standard" | "transition";
  disabled?: boolean;
};

/**
 * The `...` menu for a record. One control on every width — a bottom sheet on a
 * phone, the desktop dropdown from `md` — over the same action list, so the two
 * can never offer different things. Renders nothing when there is no action.
 *
 * `pageMenu`: this is the record page's own ⋯ in its header, so its dropdown
 * (from `md`) also holds the page's "What is this?" and Help
 * (components/navigation/page-menu.tsx). The phone's sheet does not list
 * them; there the page header's own ⋯ does.
 */
export function EntityActionSheet({ name, actions, pageMenu = false }: { name: string; actions: EntityAction[]; pageMenu?: boolean }) {
  const t = useTranslations("ui");
  const phone = usePhone();
  useClaimPageMenu(pageMenu && actions.length > 0 && phone === false);
  if (actions.length === 0) return null;
  const ordered = [...actions.filter((a) => !a.destructive), ...actions.filter((a) => a.destructive)];
  const firstDestructive = ordered.findIndex((a) => a.destructive);

  return (
    <>
      {/* `data-page-menu`: in a page header, below lg the ⋯ goes to the end of the title row (components/ui/page-header.tsx). */}
      <div className="md:hidden" data-entity-actions="sheet" data-page-menu>
        <RecordActionSheet name={name}>
          {ordered.map((action) =>
            action.href ? (
              <SheetActionLink key={action.key} href={action.href} icon={action.icon}>
                {action.label}
              </SheetActionLink>
            ) : (
              <SheetActionButton key={action.key} onSelect={action.onSelect ?? (() => undefined)} icon={action.icon} destructive={action.destructive} disabled={action.disabled}>
                {action.label}
              </SheetActionButton>
            ),
          )}
        </RecordActionSheet>
      </div>
      <div className="hidden md:block" data-entity-actions="menu" data-page-menu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t("mob04MoreActions", { name })} icon={<MoreHorizontal aria-hidden="true" />} data-testid="entity-actions" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ordered.map((action, index) => (
              <React.Fragment key={action.key}>
                {index === firstDestructive && index > 0 ? <DropdownMenuSeparator /> : null}
                {action.href ? (
                  <DropdownMenuItem asChild>
                    <Link href={action.href}>
                      {action.icon}
                      {action.label}
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant={action.destructive ? "destructive" : "default"} disabled={action.disabled} onSelect={() => action.onSelect?.()}>
                    {action.icon}
                    {action.label}
                  </DropdownMenuItem>
                )}
              </React.Fragment>
            ))}
            {pageMenu && phone === false ? <PageMenuItems separator /> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
