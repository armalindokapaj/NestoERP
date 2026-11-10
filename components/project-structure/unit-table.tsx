"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ExternalLink, MoreHorizontal, MoveRight, Pencil, Trash2 } from "@/components/icons";

import { RecordActionSheet, SheetActionButton, SheetActionLink } from "@/components/data/record-action-sheet";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { UnitDTO } from "@/lib/modules/project-structure/structure.types";

/**
 * The Units tab's row actions (E-05B §46, §109): the menu at the end of a row
 * and, on a phone or tablet, the same actions in one bottom sheet — only those
 * this person holds. The table itself is the one both unit lists share
 * (unit-list/unit-list-table.tsx, 2026-11-09). Archive sits beside Delete.
 */

export type UnitRowActions = {
  canUpdate: boolean;
  canMove: boolean;
  canDelete: boolean;
  /** Archive, or Restore an archived unit (`project.unit.archive`). */
  canArchive: boolean;
  /** Only inside one floor, in the structure order, for somebody who orders the structure (§51). */
  canReorder: boolean;
  onEdit: (unit: UnitDTO) => void;
  onMove: (unit: UnitDTO) => void;
  onDelete: (unit: UnitDTO) => void;
  onArchive: (unit: UnitDTO) => void;
  onRestore: (unit: UnitDTO) => void;
  onReorder: (unit: UnitDTO, offset: -1 | 1) => void;
};

/** Whether the person may do anything to a unit beyond opening it. */
export function hasActions(actions: UnitRowActions): boolean {
  return actions.canUpdate || actions.canMove || actions.canDelete || actions.canArchive || actions.canReorder;
}

export function UnitRowMenu({ unit, href, index, count, actions }: { unit: UnitDTO; href: string; index: number; count: number; actions: UnitRowActions }) {
  // A reader with nothing to do but open the unit already has the link.
  const t = useTranslations("projects");
  if (!hasActions(actions)) return null;
  const archived = unit.publication.status === "ARCHIVED";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("unitTable.actionsFor", { code: unit.label })}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={href}>
            <ExternalLink aria-hidden="true" />
            {t("unitTable.openUnit")}
          </Link>
        </DropdownMenuItem>
        {actions.canUpdate ? (
          <DropdownMenuItem onSelect={() => actions.onEdit(unit)}>
            <Pencil aria-hidden="true" />
            {t("unitTable.edit")}
          </DropdownMenuItem>
        ) : null}
        {actions.canMove ? (
          <DropdownMenuItem onSelect={() => actions.onMove(unit)}>
            <MoveRight aria-hidden="true" />
            {t("unitTable.moveToFloor")}
          </DropdownMenuItem>
        ) : null}
        {actions.canReorder ? (
          <>
            <DropdownMenuItem disabled={index === 0} onSelect={() => actions.onReorder(unit, -1)}>
              <ArrowUp aria-hidden="true" />
              {t("workspace.moveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => actions.onReorder(unit, 1)}>
              <ArrowDown aria-hidden="true" />
              {t("workspace.moveDown")}
            </DropdownMenuItem>
          </>
        ) : null}
        {actions.canArchive ? (
          archived ? (
            <DropdownMenuItem onSelect={() => actions.onRestore(unit)}>
              <ArchiveRestore aria-hidden="true" />
              {t("publishing.restore")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => actions.onArchive(unit)}>
              <Archive aria-hidden="true" />
              {t("publishing.archive")}
            </DropdownMenuItem>
          )
        ) : null}
        {actions.canDelete ? (
          <DropdownMenuItem className="text-danger-strong" onSelect={() => actions.onDelete(unit)}>
            <Trash2 aria-hidden="true" />
            {t("unitTable.delete")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The phone's row actions: one bottom sheet with the same actions the desktop menu offers, and only those this person holds. */
export function UnitActionSheet({ unit, href, index, count, actions }: { unit: UnitDTO; href: string; index: number; count: number; actions: UnitRowActions }) {
  const t = useTranslations("projects");
  if (!hasActions(actions)) return null;
  const archived = unit.publication.status === "ARCHIVED";
  return (
    <RecordActionSheet name={unit.label}>
      <SheetActionLink href={href} icon={<ExternalLink aria-hidden="true" />}>{t("unitTable.openUnit")}</SheetActionLink>
      {actions.canUpdate ? <SheetActionButton onSelect={() => actions.onEdit(unit)} icon={<Pencil aria-hidden="true" />}>{t("unitTable.edit")}</SheetActionButton> : null}
      {actions.canMove ? <SheetActionButton onSelect={() => actions.onMove(unit)} icon={<MoveRight aria-hidden="true" />}>{t("unitTable.moveToFloor")}</SheetActionButton> : null}
      {actions.canReorder ? (
        <>
          <SheetActionButton disabled={index === 0} onSelect={() => actions.onReorder(unit, -1)} icon={<ArrowUp aria-hidden="true" />}>{t("workspace.moveUp")}</SheetActionButton>
          <SheetActionButton disabled={index === count - 1} onSelect={() => actions.onReorder(unit, 1)} icon={<ArrowDown aria-hidden="true" />}>{t("workspace.moveDown")}</SheetActionButton>
        </>
      ) : null}
      {actions.canArchive ? (
        archived ? (
          <SheetActionButton onSelect={() => actions.onRestore(unit)} icon={<ArchiveRestore aria-hidden="true" />}>{t("publishing.restore")}</SheetActionButton>
        ) : (
          <SheetActionButton onSelect={() => actions.onArchive(unit)} icon={<Archive aria-hidden="true" />}>{t("publishing.archive")}</SheetActionButton>
        )
      ) : null}
      {actions.canDelete ? <SheetActionButton destructive onSelect={() => actions.onDelete(unit)} icon={<Trash2 aria-hidden="true" />}>{t("unitTable.delete")}</SheetActionButton> : null}
    </RecordActionSheet>
  );
}
