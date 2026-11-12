"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";

import { useLocale, useTranslations } from "@/components/i18n/i18n-provider";
import { MobileRecordCard, MobileRecordRow } from "@/components/data/mobile-record";
import Link from "@/components/navigation/nav-link";
import { useFeedbackRouter } from "@/components/navigation/navigation-feedback";
import { SalesLabel } from "@/components/sales/sales-text";
import { COMMERCIAL_CARD_TINT, COMMERCIAL_KEY, COMMERCIAL_ROW_TINT, CommercialStatusBadge, moneyLabel, perSqmLabel } from "@/components/sales/unit-sales/commercial-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { opensRow, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/i18n/format";
import { floorName, unitTypeName } from "@/lib/i18n/stock-names";
import { pageWindow } from "@/lib/modules/shared/list-query";
import { UNIT_SALE_STATUS_LABELS } from "@/lib/modules/sales/units/unit-sales.types";
import { isPlainClick, offersAdd, type PanelField } from "@/lib/modules/project-structure/unit-panel.rules";
import { cn } from "@/lib/utils/cn";
import { areaText, countText } from "../structure-ui";
import type { UnitListKind } from "../unit-filters";
import type { UnitListRow } from "./unit-list-row";

/**
 * One table for the Units and the Sales tab (2026-11-09, "Two tabs, one
 * table"). Units is for setting up and Sales for selling, so each has its own
 * columns — Units: Unit, Type, Floor, Bedrooms, Gross, Total price; Sales:
 * Unit (its type under it), Floor, Bedrooms, Area, Status, Total price, price
 * per m², and Client, Deal and Expires once a unit on screen is reserved or
 * sold — but the same code ("T-501"), the same words, the same row tints and
 * the same tick boxes. Below the table Units is a phone's compact lines, as
 * Sales units draws its list (2026-11-12), and Sales its record cards, which
 * carry the reservation and its actions.
 *
 * The whole row opens the unit; the tick box and the menu at the row's ends do
 * not. With `onOpen` (2026-11-09) a click — or Enter on the code — opens the
 * unit in the side panel beside the list; the code stays a real link, so a
 * modified or middle click opens its page. An empty Bedrooms, Gross, Area or
 * Total price cell offers a faint "Add" to somebody who may fill it in, which
 * opens the panel on that field. A tick box is drawn only for somebody who may
 * change units together.
 * Rows are tinted by sale status — green for sale, orange reserved, red sold —
 * which is also said in words: a badge on Sales, a screen-reader line and a
 * colour key on Units.
 *
 * The table fits its column without scrolling sideways at the narrowest
 * desktop window: cells are padded 12px a side, the tick and menu columns 8px.
 */

/** Narrower cell padding than the table's default, so the columns fit beside the structure tree. */
const FIT = "[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-3 [&_td:last-child]:px-2 [&_th:last-child]:px-2";
/** Sales with its Client, Deal and Expires columns: 8px a side, so the row's menu stays in view at 1440px. */
const FIT_DEAL = "[&_td]:px-2 [&_th]:px-2 [&_td:first-child]:pl-3 [&_th:first-child]:pl-3";

export type UnitListSelection = {
  isSelected: (id: string) => boolean;
  toggle: (row: UnitListRow) => void;
  /** The header tick: ticks or unticks the whole page. */
  page: "all" | "some" | "none";
  togglePage: (on: boolean) => void;
};

const TEST_IDS = {
  units: { table: "unit-table", row: "unit-row", cards: "unit-cards", card: "unit-card" },
  sales: { table: "sales-table", row: "sales-row", cards: "sales-cards", card: "sales-card" },
} as const;

function StatusWords({ row }: { row: UnitListRow }) {
  return (
    <span className="sr-only">
      {" "}
      (<SalesLabel group="commercialStatus" value={row.saleStatus} fallback={UNIT_SALE_STATUS_LABELS[row.saleStatus]} />)
    </span>
  );
}

/** One line under the Units table naming the row colours (2026-11-09): For sale, Reserved, Sold. Other rows stay plain. */
export function ColourKey({ className }: { className?: string }) {
  const t = useTranslations("projects");
  return (
    <p className={cn("mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-fg-muted", className)} data-testid="unit-colour-key">
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

/** An empty cell's faint "Add": opens the unit's panel on that field. */
function AddCell({ row, field, onOpen }: { row: UnitListRow; field: PanelField; onOpen: (row: UnitListRow, field: PanelField) => void }) {
  const t = useTranslations("projects");
  return (
    <button
      type="button"
      className="tap-target rounded text-meta text-fg-subtle/80 underline-offset-2 hover:text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-label={t("unitPanel.addFor", { field: t(`unitPanel.field.${field}`), code: row.label })}
      onClick={() => onOpen(row, field)}
      data-testid={`unit-add-${field}`}
    >
      {t("unitPanel.add")}
    </button>
  );
}

function RowTick({ row, selection }: { row: UnitListRow; selection: UnitListSelection }) {
  const t = useTranslations("projects");
  return <Checkbox checked={selection.isSelected(row.id)} onCheckedChange={() => selection.toggle(row)} aria-label={t("unitList.tick", { code: row.label })} data-testid="unit-tick" />;
}

export function UnitListTable({
  kind,
  rows,
  total,
  page,
  pageSize,
  onPage,
  loading,
  href,
  selection,
  rowMenu,
  cardActions,
  deal,
  onOpen,
  openId = null,
  addable = { details: false, price: false },
}: {
  kind: UnitListKind;
  rows: UnitListRow[];
  total: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  loading: boolean;
  /** Where a row opens: the unit's Overview from Units, its Sales section from Sales. */
  href: (row: UnitListRow) => string;
  /** Tick boxes, for somebody who may change units together. */
  selection?: UnitListSelection;
  /** The row's own menu at its end (desktop). */
  rowMenu?: (row: UnitListRow, index: number) => React.ReactNode;
  /** The card's own actions (phone and tablet). */
  cardActions?: (row: UnitListRow, index: number) => React.ReactNode;
  /** Sales: which reservation columns to draw — only once a unit on screen is reserved or sold. */
  deal?: { show: boolean; client: boolean; deal: boolean };
  /** Opens a unit in the side panel instead of its page, on the field an empty cell's "Add" names. */
  onOpen?: (row: UnitListRow, field?: PanelField) => void;
  /** The unit the panel shows, marked in the list. */
  openId?: string | null;
  /** Who may fill an empty cell in: the details (bedrooms, areas) and the price. */
  addable?: { details: boolean; price: boolean };
}) {
  const locale = useLocale();
  const t = useTranslations("projects");
  const nav = useFeedbackRouter();
  const ids = TEST_IDS[kind];
  const sales = kind === "sales";
  const range = pageWindow(total, page, pageSize);
  const price = (row: UnitListRow) => moneyLabel(row.askingPrice, row.currency, locale);
  const areaWord = (row: UnitListRow) => (row.saleArea === null ? null : row.saleAreaBasis === "SALEABLE_AREA" ? t("unitTable.areaSaleable") : t("unitTable.areaGross"));
  const showDeal = Boolean(sales && deal?.show);
  // The table from md on Units (no tree beside it below lg); from lg on Sales, which is wider (mobile audit 2d).
  const tableShown = sales ? "hidden lg:block" : "hidden md:block";
  const cardsShown = sales ? "lg:hidden" : "md:hidden";
  /** A plain click on the code opens the panel; a modified or middle click goes on to the page. */
  const openFromLink = (row: UnitListRow) =>
    onOpen
      ? (event: React.MouseEvent<HTMLAnchorElement>) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          onOpen(row);
        }
      : undefined;
  /** The cell's value, or its "Add" while it is empty and the reader may fill it in. */
  const orAdd = (row: UnitListRow, field: PanelField, value: React.ReactNode) => (onOpen && offersAdd(row, field, addable) ? <AddCell row={row} field={field} onOpen={onOpen} /> : value);
  // Units on a phone ticks as the shared phone lists do (components/data/selection.tsx): the boxes come with
  // Select, or by themselves once a unit on the page is ticked (Fill in, Select all), so a line keeps its room.
  const tUi = useTranslations("ui");
  const [choosing, setChoosing] = React.useState(false);
  const pageTicked = selection ? rows.some((row) => selection.isSelected(row.id)) : false;
  const boxes = Boolean(selection) && (choosing || pageTicked);

  return (
    <div className={loading ? "opacity-60 transition-opacity" : undefined} aria-busy={loading}>
      <div className={tableShown}>
        <Table label={sales ? t("unitList.salesTable") : t("unitTable.units")} data-testid={ids.table} className={showDeal ? FIT_DEAL : FIT}>
          <TableHead>
            <tr>
              {selection ? (
                <TableHeaderCell className="w-px">
                  <Checkbox
                    checked={selection.page === "all" ? true : selection.page === "some" ? "indeterminate" : false}
                    onCheckedChange={() => selection.togglePage(selection.page !== "all")}
                    aria-label={t("unitList.tickPage")}
                    data-testid="unit-tick-page"
                  />
                </TableHeaderCell>
              ) : null}
              <TableHeaderCell>{t("unitTable.unit")}</TableHeaderCell>
              {sales ? null : <TableHeaderCell>{t("unitTable.type")}</TableHeaderCell>}
              <TableHeaderCell>{t("unitTable.floor")}</TableHeaderCell>
              <TableHeaderCell numeric>{t("unitTable.bedrooms")}</TableHeaderCell>
              {sales ? <TableHeaderCell numeric>{t("unitTable.area")}</TableHeaderCell> : <TableHeaderCell numeric>{t("unitTable.gross")}</TableHeaderCell>}
              {sales ? <TableHeaderCell>{t("unitTable.status")}</TableHeaderCell> : null}
              <TableHeaderCell numeric>{t("unitTable.totalPrice")}</TableHeaderCell>
              {sales ? <TableHeaderCell numeric>{t("unitTable.pricePerSqm")}</TableHeaderCell> : null}
              {showDeal && deal?.client ? <TableHeaderCell>{t("unitTable.client")}</TableHeaderCell> : null}
              {showDeal && deal?.deal ? <TableHeaderCell>{t("unitTable.deal")}</TableHeaderCell> : null}
              {showDeal ? <TableHeaderCell>{t("unitTable.expires")}</TableHeaderCell> : null}
              {rowMenu ? (
                <TableHeaderCell className="w-px">
                  <span className="sr-only">{t("unitTable.actions")}</span>
                </TableHeaderCell>
              ) : null}
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow
                key={row.id}
                data-testid={ids.row}
                data-unit-code={row.unitCode}
                data-status={sales ? row.saleStatus : row.status}
                interactive
                selected={selection?.isSelected(row.id)}
                aria-current={openId === row.id ? "true" : undefined}
                className={cn(COMMERCIAL_ROW_TINT[row.status], openId === row.id && "[&>td]:shadow-[inset_0_1px_0_var(--nesto-accent),inset_0_-1px_0_var(--nesto-accent)]")}
                onClick={(event) => {
                  // Anywhere on the row opens the unit; the tick box, the menu, the "Add"s and the client and deal links keep their own.
                  if (!opensRow(event)) return;
                  if (onOpen) onOpen(row);
                  else nav.push(href(row));
                }}
              >
                {selection ? (
                  <TableCell className="w-px">
                    <RowTick row={row} selection={selection} />
                  </TableCell>
                ) : null}
                <TableCell className="whitespace-nowrap">
                  <Link href={href(row)} className="font-medium text-fg hover:text-accent-strong" onClick={openFromLink(row)} data-testid="unit-open">
                    {row.label}
                  </Link>
                  {sales ? <span className="block text-meta text-fg-subtle">{unitTypeName(row.typeName, locale)}</span> : <StatusWords row={row} />}
                  {row.isActive ? null : <Badge className="ml-2">{t("unitTable.inactive")}</Badge>}
                  {row.archived ? <Badge className="ml-2" data-testid="unit-archived">{t("publication.ARCHIVED")}</Badge> : null}
                </TableCell>
                {sales ? null : <TableCell>{unitTypeName(row.typeName, locale)}</TableCell>}
                {/* A long floor name ("Ground Floor Mezzanine") wraps, so Sales' reservation columns fit at 1440px and Units at 1024px. */}
                <TableCell className={sales ? "min-w-[7.5rem]" : "min-w-[6.5rem]"}>{floorName(row.floorName, locale)}</TableCell>
                <TableCell numeric>{orAdd(row, "bedrooms", countText(row.bedrooms))}</TableCell>
                {sales ? (
                  <TableCell numeric className="whitespace-nowrap" data-testid="sales-area" data-basis={row.saleAreaBasis}>
                    {orAdd(
                      row,
                      "area",
                      <>
                        {areaText(row.saleArea, locale)}
                        {areaWord(row) ? <span className="block text-meta text-fg-subtle">{areaWord(row)}</span> : null}
                      </>,
                    )}
                  </TableCell>
                ) : (
                  <TableCell numeric className="whitespace-nowrap">
                    {orAdd(row, "gross", areaText(row.grossArea, locale))}
                  </TableCell>
                )}
                {sales ? (
                  <TableCell>
                    <CommercialStatusBadge status={row.saleStatus} />
                  </TableCell>
                ) : null}
                <TableCell numeric className="whitespace-nowrap" data-testid="unit-price">
                  {orAdd(row, "price", price(row))}
                </TableCell>
                {sales ? (
                  <TableCell numeric className="whitespace-nowrap text-fg-muted">
                    {perSqmLabel(row.pricePerSqm, row.currency, locale)}
                  </TableCell>
                ) : null}
                {showDeal && deal?.client ? (
                  <TableCell>
                    {/* A table cell ignores max-width, so the link carries it: a long name is cut, not the row's menu. */}
                    {row.client ? (
                      <Link href={`/clients/${row.client.id}`} className="block max-w-[8rem] truncate hover:underline" title={row.client.name}>
                        {row.client.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                ) : null}
                {showDeal && deal?.deal ? (
                  <TableCell>
                    {row.deal ? (
                      <Link href={`/sales/opportunities/${row.deal.id}`} className="block max-w-[8rem] truncate hover:underline" title={row.deal.name}>
                        {row.deal.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                ) : null}
                {showDeal ? <TableCell className="whitespace-nowrap text-fg-muted">{row.reservationExpiresAt ? formatDate(row.reservationExpiresAt, locale) : "—"}</TableCell> : null}
                {rowMenu ? <TableCell className="text-right">{rowMenu(row, index)}</TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {sales ? (
        // The Sales tab on a phone and tablet (MOB-03 §45): the shared record card, with its tick box. The unit opens from the whole card.
        <ul className={cn("space-y-2", cardsShown)} data-testid={ids.cards}>
          {rows.map((row, index) => {
            const more = [areaText(row.saleArea, locale) + (areaWord(row) ? ` ${areaWord(row)}` : ""), row.pricePerSqm !== null ? perSqmLabel(row.pricePerSqm, row.currency, locale) : null].filter(Boolean);
            const reservation = row.client || row.reservationExpiresAt ? [row.client?.name ?? null, row.reservationExpiresAt ? t("unitTable.expiresOn", { date: formatDate(row.reservationExpiresAt, locale) }) : null].filter(Boolean).join(" · ") : null;
            return (
              <MobileRecordCard
                key={row.id}
                data={{ "data-testid": ids.card, "data-unit-code": row.unitCode, "data-status": row.saleStatus }}
                href={href(row)}
                onOpen={openFromLink(row)}
                selection={selection ? <span className="grid size-11 place-items-center"><RowTick row={row} selection={selection} /></span> : undefined}
                selected={selection?.isSelected(row.id)}
                title={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-body font-semibold text-fg">{row.label}</span>
                    <span className="text-table font-normal text-fg-muted">{unitTypeName(row.typeName, locale)}</span>
                    {row.isActive ? null : <Badge>{t("unitTable.inactive")}</Badge>}
                    {row.archived ? <Badge data-testid="unit-archived">{t("publication.ARCHIVED")}</Badge> : null}
                  </span>
                }
                status={<CommercialStatusBadge status={row.saleStatus} />}
                subtitle={
                  <span className="text-meta text-fg-subtle">
                    {floorName(row.floorName, locale)}
                    {row.bedrooms !== null ? t("unitTable.bed", { count: row.bedrooms }) : ""}
                    {row.askingPrice ? ` · ${price(row)}` : ""}
                  </span>
                }
                extra={
                  more.length > 0 || reservation ? (
                    <>
                      {more.length > 0 ? (
                        <p className="mt-1 text-meta text-fg-subtle" data-testid="sales-card-more">
                          {more.join(" · ")}
                        </p>
                      ) : null}
                      {reservation ? <p className="mt-1 text-meta text-fg-muted">{reservation}</p> : null}
                    </>
                  ) : null
                }
                actions={cardActions?.(row, index)}
                className={cn("p-3", COMMERCIAL_CARD_TINT[row.status])}
              />
            );
          })}
        </ul>
      ) : (
        // Units on a phone (2026-11-12): Sales units' compact lines in one lined block — the code with its gross
        // area, the floor and type under it, the price over the status at the right, the unit's ⋯, and the tick
        // box while ticking. The whole line opens the unit; the status is said by its badge, not a tint.
        <>
          {selection && !pageTicked ? (
            <div className={cn("mb-2 flex justify-end", cardsShown)}>
              <Button type="button" variant="secondary" size="sm" aria-pressed={choosing} onClick={() => setChoosing(!choosing)} data-testid="unit-select-mode">
                {choosing ? tUi("doneSelecting") : tUi("select")}
              </Button>
            </div>
          ) : null}
          <ul className={cn("nesto-card overflow-hidden", cardsShown)} data-testid={ids.cards}>
            {rows.map((row, index) => (
              <MobileRecordRow
                key={row.id}
                data={{ "data-testid": ids.card, "data-unit-code": row.unitCode, "data-status": row.status }}
                href={href(row)}
                onOpen={openFromLink(row)}
                label={[row.label, floorName(row.floorName, locale), unitTypeName(row.typeName, locale)].join(", ")}
                selection={boxes && selection ? <span className="-ml-3 grid size-11 place-items-center"><RowTick row={row} selection={selection} /></span> : undefined}
                selected={selection?.isSelected(row.id)}
                title={
                  <>
                    <span className="whitespace-nowrap tabular-nums">{row.label}</span>
                    {row.grossArea !== null ? (
                      <span className="ml-2 whitespace-nowrap text-table font-normal tabular-nums text-fg-subtle" data-testid="unit-card-area">
                        {areaText(row.grossArea, locale)}
                      </span>
                    ) : null}
                    {row.isActive ? null : <Badge className="ml-2">{t("unitTable.inactive")}</Badge>}
                    {row.archived ? <Badge className="ml-2" data-testid="unit-archived">{t("publication.ARCHIVED")}</Badge> : null}
                  </>
                }
                subtitle={`${floorName(row.floorName, locale)} · ${unitTypeName(row.typeName, locale)}`}
                value={
                  <span className="flex flex-col items-end gap-1">
                    {row.askingPrice ? <span data-testid="unit-card-price">{price(row)}</span> : null}
                    <CommercialStatusBadge status={row.saleStatus} />
                  </span>
                }
                actions={cardActions?.(row, index)}
              />
            ))}
          </ul>
        </>
      )}

      {/* The row colours, where rows are tinted: the Units table from md (a phone line says its status with a badge). */}
      {sales ? null : <ColourKey className="max-md:hidden" />}

      {range.totalPages > 1 ? (
        <nav aria-label={t("unitTable.pagination")} className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-table text-fg-muted" aria-live="polite" data-testid="pagination-count">
            <span className="tabular-nums">
              {range.from}–{range.to}
            </span>{" "}
            {t("unitTable.of")} <span className="tabular-nums">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
              <ChevronLeft aria-hidden="true" />
              {t("unitTable.previous")}
            </Button>
            <span className="text-table tabular-nums text-fg-subtle">{t("unitTable.page", { page: range.page, pages: range.totalPages })}</span>
            <Button variant="secondary" size="sm" disabled={page >= range.totalPages || loading} onClick={() => onPage(page + 1)}>
              {t("unitTable.next")}
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : (
        <p className="mt-3 text-table text-fg-muted" aria-live="polite" data-testid="pagination-count">
          {total === 0 ? (
            <>
              <span className="tabular-nums">0</span> {t("unitTable.results")}
            </>
          ) : (
            <>
              <span className="tabular-nums">
                {range.from}–{range.to}
              </span>{" "}
              {t("unitTable.of")} <span className="tabular-nums">{total}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
