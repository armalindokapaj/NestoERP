"use client";

import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import * as React from "react";
import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ExternalLink, MoreHorizontal, MoveRight, Pencil, Trash2 } from "lucide-react";

import { MobileRecordCard } from "@/components/data/mobile-record";
import { RecordActionSheet, SheetActionButton, SheetActionLink } from "@/components/data/record-action-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { opensRow, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useFeedbackRouter } from "@/components/navigation/navigation-feedback";
import { SalesLabel } from "@/components/sales/sales-text";
import { COMMERCIAL_CARD_TINT, COMMERCIAL_KEY, COMMERCIAL_ROW_TINT, moneyLabel } from "@/components/sales/unit-sales/commercial-status";
import { type UnitDTO, type UnitListDTO } from "@/lib/modules/project-structure/structure.types";
import { saleStatusOf } from "@/lib/modules/sales/units/unit-sales.rules";
import { UNIT_SALE_STATUS_LABELS } from "@/lib/modules/sales/units/unit-sales.types";
import { cn } from "@/lib/utils/cn";
import { areaText, countText } from "./structure-ui";
import { pageWindow } from "@/lib/modules/shared/list-query";

/**
 * The unit table (E-05B §46, §109; columns as the user set them, 2026-11): Unit
 * (the building's code and the unit's, "T-501"), Type, Floor, Bedrooms, Gross
 * area and Total price — the asking price. Where a unit stands
 * commercially is the row's colour: green for sale, orange reserved, red sold;
 * Not for sale and On hold stay plain. The colour is also said in words to a
 * screen reader — Not Priced for a unit nobody has priced yet — and a key under
 * the table names the three colours. The whole row opens the unit; the menu at
 * its end does not, and holds Archive beside Delete (2026-11-09).
 *
 * The table fits its column without scrolling sideways down to the narrowest
 * desktop window (1024px, beside the structure tree, which narrows there): the
 * cells are padded 12px a side and the menu column 8px; the type and an
 * Inactive badge may wrap, while the code, floor, area and price stay on one line.
 */


/** Narrower cell padding than the table's default, so the seven columns fit beside the structure tree. */
const FIT = "[&_td]:px-3 [&_th]:px-3 [&_td:last-child]:px-2 [&_th:last-child]:px-2";


function StatusWords({ unit }: { unit: UnitDTO }) {
  const status = saleStatusOf(unit.commercialStatus, unit.askingPrice?.amount ?? null);
  return (
    <span className="sr-only">
      {" "}
      (<SalesLabel group="commercialStatus" value={status} fallback={UNIT_SALE_STATUS_LABELS[status]} />)
    </span>
  );
}

/** One line under the table naming the row colours (2026-11-09): For sale, Reserved, Sold. Other rows stay plain. */
function ColourKey() {
  const t = useTranslations("projects");
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-muted" data-testid="unit-colour-key">
      <span className="sr-only">{t("unitTable.colourKey")}</span>
      {COMMERCIAL_KEY.map((entry) => (
        <span key={entry.status} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-2.5 rounded-full", entry.dot)} />
          <SalesLabel group="commercialStatus" value={entry.status} fallback={UNIT_SALE_STATUS_LABELS[entry.status]} />
        </span>
      ))}
    </p>
  );
}

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
function hasActions(actions: UnitRowActions): boolean {
  return actions.canUpdate || actions.canMove || actions.canDelete || actions.canArchive || actions.canReorder;
}

function RowMenu({ unit, href, index, count, actions }: { unit: UnitDTO; href: string; index: number; count: number; actions: UnitRowActions }) {
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
function UnitActionSheet({ unit, href, index, count, actions }: { unit: UnitDTO; href: string; index: number; count: number; actions: UnitRowActions }) {
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

export function UnitTable({ projectId, list, actions, onPage, loading }: { projectId: string; list: UnitListDTO; actions: UnitRowActions; onPage: (page: number) => void; loading: boolean }) {
  const locale = useLocale();
  const nav = useFeedbackRouter();
  const href = (unit: UnitDTO) => `/projects/${projectId}/units/${unit.id}`;
  const label = (unit: UnitDTO) => unit.label;
  const price = (unit: UnitDTO) => moneyLabel(unit.askingPrice?.amount ?? null, unit.askingPrice?.currency ?? null, locale);
  const t = useTranslations("projects");
  // "1–50 of 73", "0 results", and a count on a single page too (AUD-08 §4, DT-05).
  const range = pageWindow(list.total, list.page, list.pageSize);
  const first = range.from;
  const last = range.to;
  const pages = range.totalPages;

  return (
    <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
      <div className="hidden md:block">
        <Table label={t("unitTable.units")} data-testid="unit-table" className={FIT}>
          <TableHead>
            <tr>
              <TableHeaderCell>{t("unitTable.unit")}</TableHeaderCell>
              <TableHeaderCell>{t("unitTable.type")}</TableHeaderCell>
              <TableHeaderCell>{t("unitTable.floor")}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t("unitTable.bedrooms")}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t("unitTable.gross")}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t("unitTable.totalPrice")}</TableHeaderCell>
              <TableHeaderCell className="w-px">
                <span className="sr-only">{t("unitTable.actions")}</span>
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {list.items.map((unit, index) => (
              <TableRow
                key={unit.id}
                data-testid="unit-row"
                data-unit-code={unit.unitCode}
                data-status={unit.commercialStatus}
                interactive
                className={COMMERCIAL_ROW_TINT[unit.commercialStatus]}
                onClick={(event) => {
                  if (opensRow(event)) nav.push(href(unit));
                }}
              >
                <TableCell>
                  <Link href={href(unit)} className="whitespace-nowrap font-medium text-fg hover:text-accent-strong">
                    {label(unit)}
                  </Link>
                  <StatusWords unit={unit} />
                  {unit.isActive ? null : <Badge className="ml-2">{t("unitTable.inactive")}</Badge>}
                </TableCell>
                <TableCell>{unitTypeName(unit.unitType.name, locale)}</TableCell>
                <TableCell className="whitespace-nowrap">{floorName(unit.floor.name, locale)}</TableCell>
                <TableCell className="text-right tabular-nums">{countText(unit.bedrooms)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">{areaText(unit.areas.grossArea, locale)}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums" data-testid="unit-price">{price(unit)}</TableCell>
                <TableCell className="text-right">
                  <RowMenu unit={unit} href={href(unit)} index={index} count={list.items.length} actions={actions} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Phone (MOB-03 §45): the shared record card. The unit opens from the whole card; the actions are one sheet. */}
      <ul className="space-y-2 md:hidden" data-testid="unit-cards">
        {list.items.map((unit, index) => {
          const more = [
            unit.areas.grossArea !== null ? t("unitTable.grossSuffix", { area: areaText(unit.areas.grossArea, locale) }) : null,
            unit.askingPrice ? price(unit) : null,
          ].filter(Boolean);
          return (
            <MobileRecordCard
              key={unit.id}
              data={{ "data-testid": "unit-card", "data-unit-code": unit.unitCode, "data-status": unit.commercialStatus }}
              href={href(unit)}
              title={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-body font-semibold text-fg">
                    {label(unit)}
                    <StatusWords unit={unit} />
                  </span>
                  <span className="text-table font-normal text-fg-muted">{unitTypeName(unit.unitType.name, locale)}</span>
                  {unit.isActive ? null : <Badge>{t("unitTable.inactive")}</Badge>}
                </span>
              }
              subtitle={
                <span className="text-meta text-fg-subtle">
                  {floorName(unit.floor.name, locale)}
                  {unit.bedrooms !== null ? t("unitTable.bed", { count: unit.bedrooms }) : ""}
                </span>
              }
              extra={more.length > 0 ? <p className="mt-1 text-meta text-fg-subtle" data-testid="unit-card-more">{more.join(" · ")}</p> : null}
              actions={<UnitActionSheet unit={unit} href={href(unit)} index={index} count={list.items.length} actions={actions} />}
              className={cn("p-3", COMMERCIAL_CARD_TINT[unit.commercialStatus])}
            />
          );
        })}
      </ul>

      <ColourKey />

      {pages > 1 ? (
        <nav aria-label={t("unitTable.pagination")} className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-table text-fg-muted" aria-live="polite" data-testid="pagination-count">
            <span className="tabular-nums">
              {first}–{last}
            </span>{" "}
            {t("unitTable.of")} <span className="tabular-nums">{list.total}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={list.page <= 1 || loading} onClick={() => onPage(list.page - 1)}>
              <ChevronLeft aria-hidden="true" />
              {t("unitTable.previous")}
            </Button>
            <span className="text-table tabular-nums text-fg-subtle">
              {t("unitTable.page", { page: range.page, pages })}
            </span>
            <Button variant="secondary" size="sm" disabled={list.page >= pages || loading} onClick={() => onPage(list.page + 1)}>
              {t("unitTable.next")}
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : (
        <p className="mt-3 text-table text-fg-muted" aria-live="polite" data-testid="pagination-count">
          {list.total === 0 ? (
            <>
              <span className="tabular-nums">0</span> {t("unitTable.results")}
            </>
          ) : (
            <>
              <span className="tabular-nums">
                {first}–{last}
              </span>{" "}
              {t("unitTable.of")} <span className="tabular-nums">{list.total}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
