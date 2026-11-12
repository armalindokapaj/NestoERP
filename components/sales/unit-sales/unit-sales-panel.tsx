"use client";

import * as React from "react";
import { useLocale } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { usePathname } from "next/navigation";
import { useRouter } from "@/components/navigation/guarded-router";
import { BadgeCheck, CalendarPlus, CircleX, MoreHorizontal, PauseCircle, PlayCircle, Tag, Undo2, Unlock } from "@/components/icons";

import { DetailGrid } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { areaText, structureApi } from "@/components/project-structure/structure-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { FieldsDialog } from "@/components/finance/unit-finance/fields-dialog";
import { UnitContractStatusBadge } from "@/components/finance/unit-finance/finance-status";
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/i18n/format";
import { COMMERCIAL_SOURCE_LABELS, UNIT_COMMERCIAL_STATUS_LABELS, UNIT_SOLD_RULE_LABELS, UNIT_RESERVATION_STATUS_LABELS, type ReservationDTO, type UnitSalesDTO } from "@/lib/modules/sales/units/unit-sales.types";
import { failureMessage } from "@/components/project-structure/structure-ui";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { soldMissingText } from "./sold-missing";
import { CommercialStatusBadge, moneyLabel, perSqmLabel } from "./commercial-status";
import { CorrectDialog, PriceDialog, ReopenDialog } from "./unit-sales-dialogs";
import { SaleStatusDialogs } from "./sale-status-dialogs";
import { salesExpectedVersion, saleStatusOffers } from "@/lib/modules/sales/units/unit-sales.rules";

/**
 * A unit's Sales section (E-05E §15, §19-§31, §55): where the sale stands, the
 * actions the reader may take on it now, and every price, reservation and status
 * it has had. The same panel on the unit's work page in its project and on its
 * sales page (/sales/units, components/sales/sales-unit.tsx).
 * `?action=reserve` or `?action=release` (from the inventory's phone cards)
 * opens that dialog, when the reader may take it.
 */

type Open = "price" | "hold" | "reserve" | "extend" | "release" | "sold" | "notSold" | "reopen" | "correct" | "putOnSale" | "takeOff" | "releaseHold" | "requestApproval" | "approveSale" | "rejectSale" | null;

export function UnitSalesPanel({ sales, initialAction }: { sales: UnitSalesDTO; initialAction?: string | null }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const t = useSalesTranslations();
  const caps = sales.capabilities;
  const reservation = sales.activeReservation;
  const [open, setOpen] = React.useState<Open>(null);
  const [pending, setPending] = React.useState(false);

  const status = sales.status;
  const offer = saleStatusOffers({ status, sellable: sales.sellable, hasReservation: Boolean(reservation), capabilities: caps });

  React.useEffect(() => {
    if (initialAction === "reserve" && offer.reserve) setOpen("reserve");
    if (initialAction === "release" && offer.release) setOpen("release");
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = React.useCallback(
    async (url: string, body: Record<string, unknown>, success: string): Promise<unknown> => {
      const answer = await structureApi(url, { method: url.endsWith("/sales") ? "PATCH" : "POST", body });
      toast({ title: success });
      // The one-shot `?action=` goes without a navigation: the dialog that just
      // saved is still on screen, and a navigation would ask about it (AUD-03 §5).
      if (initialAction) window.history.replaceState(window.history.state, "", pathname);
      router.refresh();
      return answer;
    },
    [toast, router, pathname, initialAction],
  );

  async function markSold() {
    setPending(true);
    try {
      await submit(`/api/project-units/${sales.unitId}/mark-sold`, { expectedVersion: salesExpectedVersion(sales.version) }, t("unitSales.isSold", { unit: sales.unitLabel }));
      setOpen(null);
    } catch (error) {
      setOpen(null);
      toast({ title: failureMessage(error, t("unitSales.soldFailed")), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  const menu = offer.takeOff || offer.correct;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <section className="nesto-card p-5" aria-labelledby="unit-sales-summary" data-testid="unit-sales-summary">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="unit-sales-summary" className="nesto-section-head">
              {t("unitSales.sales")}
            </h2>
            <CommercialStatusBadge status={sales.saleStatus} />
            {sales.statusChangedAt ? <span className="text-meta text-fg-subtle">{t("unitSales.since", { date: formatDate(sales.statusChangedAt, locale) })}</span> : null}
          </div>

          {!sales.sellable && (status === "NOT_FOR_SALE" || status === "FOR_SALE" || status === "ON_HOLD") ? (
            <p className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-table text-warning-strong" data-testid="unit-not-sellable">
              {t("unitSales.notSellable", { reason: sales.sellableReason ?? "" })}
            </p>
          ) : null}

          <DetailGrid
            className="mt-4"
            items={[
              { label: t("unitSales.askingPrice"), value: <span className="tabular-nums" data-testid="asking-price">{moneyLabel(sales.askingPrice, sales.currency, locale)}</span> },
              // Per m² of the sale area — saleable when typed, else gross — whatever basis the price was saved on (2026-11-09).
              { label: t("unitSales.pricePerSqm"), value: <span className="tabular-nums" data-testid="price-per-sqm">{perSqmLabel(sales.pricePerSqm, sales.currency, locale)}</span> },
              { label: t("unitSales.saleArea"), value: <span data-testid="sale-area">{sales.saleArea === null ? "—" : `${areaText(sales.saleArea, locale)} · ${sales.saleAreaBasis === "SALEABLE_AREA" ? t("unitSales.saleAreaSaleable") : t("unitSales.saleAreaGross")}`}</span> },
              ...(status === "ON_HOLD"
                ? [
                    {
                      label: t("unitSales.held"),
                      value: (
                        <>
                          {sales.heldBy ? <PersonLink memberId={sales.heldByMemberId} name={sales.heldBy} /> : "—"}
                          {sales.holdUntil ? t("unitSales.until", { date: formatDate(sales.holdUntil, locale) }) : ""}
                        </>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <SaleConditions sales={sales} onOpen={setOpen} />

          {status === "ON_HOLD" && sales.holdReason ? (
            <div className="mt-4">
              <p className="nesto-eyebrow text-fg-subtle">{t("unitSales.holdReason")}</p>
              <p className="mt-1 whitespace-pre-line text-table text-fg">{sales.holdReason}</p>
            </div>
          ) : null}
          {sales.salesNotes ? (
            <div className="mt-4">
              <p className="nesto-eyebrow text-fg-subtle">{t("unitSales.salesNotes")}</p>
              <p className="mt-1 whitespace-pre-line text-table text-fg">{sales.salesNotes}</p>
            </div>
          ) : null}

          {Object.values(offer).some(Boolean) ? (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4" data-testid="unit-sales-actions">
              {offer.putOnSale ? (
                <Button onClick={() => setOpen("putOnSale")} disabled={pending}>
                  <PlayCircle aria-hidden="true" /> {t("unitSales.putOnSale")}
                </Button>
              ) : null}
              {offer.reserve ? (
                <Button onClick={() => setOpen("reserve")} disabled={pending}>
                  <BadgeCheck aria-hidden="true" /> {t("unitSales.reserve")}
                </Button>
              ) : null}
              {offer.sold ? (
                <Button onClick={() => setOpen(sales.soldCheck.allowed ? "sold" : "notSold")} disabled={pending}>
                  <BadgeCheck aria-hidden="true" /> {t("unitSales.markSold")}
                </Button>
              ) : null}
              {offer.extend ? (
                <Button variant="secondary" onClick={() => setOpen("extend")} disabled={pending}>
                  <CalendarPlus aria-hidden="true" /> {t("unitSales.extend")}
                </Button>
              ) : null}
              {offer.release ? (
                <Button variant="secondary" onClick={() => setOpen("release")} disabled={pending}>
                  <Unlock aria-hidden="true" /> {t("unitSales.release")}
                </Button>
              ) : null}
              {offer.hold ? (
                <Button variant="secondary" onClick={() => setOpen("hold")} disabled={pending}>
                  <PauseCircle aria-hidden="true" /> {t("unitSales.hold")}
                </Button>
              ) : null}
              {offer.releaseHold ? (
                <Button variant="secondary" onClick={() => setOpen("releaseHold")} disabled={pending}>
                  <PlayCircle aria-hidden="true" /> {t("unitSales.releaseHold")}
                </Button>
              ) : null}
              {offer.reopen ? (
                <Button variant="secondary" onClick={() => setOpen("reopen")} disabled={pending}>
                  <Undo2 aria-hidden="true" /> {t("unitSales.reopenSale")}
                </Button>
              ) : null}
              {offer.price ? (
                <Button variant="secondary" onClick={() => setOpen("price")} disabled={pending}>
                  <Tag aria-hidden="true" /> {sales.askingPrice ? t("unitSales.changePrice") : t("unitSales.setPrice")}
                </Button>
              ) : null}
              {menu ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t("unitSales.moreActions")}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {offer.correct ? <DropdownMenuItem onSelect={() => setOpen("correct")}>{t("unitSales.correctReservation")}</DropdownMenuItem> : null}
                    {offer.takeOff ? <DropdownMenuItem onSelect={() => setOpen("takeOff")}>{t("unitSales.takeOffSale")}</DropdownMenuItem> : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
        </section>

        {reservation ? <ActiveReservation reservation={reservation} /> : null}

        <section className="nesto-card p-5" aria-labelledby="reservation-history">
          <h2 id="reservation-history" className="nesto-section-head">
            {t("unitSales.reservations")}
          </h2>
          {sales.reservations.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">{t("unitSales.neverReserved")}</p>
          ) : (
            <ol className="mt-3 divide-y divide-line" data-testid="reservation-history">
              {sales.reservations.map((row) => (
                <li key={row.id} className="py-2.5 text-table">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Badge tone={row.status === "ACTIVE" ? "info" : row.status === "CONVERTED_TO_SALE" ? "success" : "default"}>{salesLabel(t, "reservationStatus", row.status, UNIT_RESERVATION_STATUS_LABELS[row.status])}</Badge>
                    <span className="font-medium text-fg">{row.client?.name ?? t("unitSales.clientHidden")}</span>
                    {row.deal ? <span className="text-fg-muted">· {row.deal.name}</span> : null}
                    <span className="ml-auto tabular-nums text-fg-muted">{moneyLabel(row.agreedPrice, row.currency, locale)}</span>
                  </div>
                  <p className="mt-0.5 text-meta text-fg-subtle">
                    {formatDate(row.reservedAt, locale)} – {formatDate(row.closedAt ?? row.expiresAt, locale)}
                    {row.salesperson ? (
                      <>
                        {" · "}
                        <PersonLink memberId={row.salespersonMemberId} name={row.salesperson} />
                      </>
                    ) : null}
                    {row.extensions.length ? (row.extensions.length === 1 ? t("unitSales.extendedOnce") : t("unitSales.extendedTimes", { count: row.extensions.length })) : ""}
                  </p>
                  {row.closeReason ? <p className="mt-0.5 text-meta text-fg-muted">{row.closeReason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <div className="space-y-4 lg:self-start">
        {sales.deals.length ? (
          <section className="nesto-card p-5" aria-labelledby="unit-deals">
            <h2 id="unit-deals" className="nesto-section-head">
              {t("unitSales.deals")}
            </h2>
            <ul className="mt-3 space-y-2" data-testid="unit-deals">
              {sales.deals.map((deal) => (
                <li key={deal.id} className="flex items-baseline justify-between gap-2 text-table">
                  <Link href={`/sales/opportunities/${deal.id}`} className="truncate font-medium text-fg hover:underline">
                    {deal.name}
                  </Link>
                  <span className="tabular-nums text-fg-muted">{moneyLabel(deal.agreedPrice, deal.currency, locale)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="nesto-card p-5" aria-labelledby="price-history">
          <h2 id="price-history" className="nesto-section-head">
            {t("unitSales.priceHistory")}
          </h2>
          {sales.priceHistory.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">{t("unitSales.noPrice")}</p>
          ) : (
            <ol className="mt-3 divide-y divide-line" data-testid="price-history">
              {sales.priceHistory.map((row) => (
                <li key={row.id} className="py-2 text-table">
                  <p className="tabular-nums text-fg">
                    {row.oldPrice ? `${moneyLabel(row.oldPrice, row.oldCurrency, locale)} → ` : ""}
                    <span className="font-medium">{moneyLabel(row.newPrice, row.currency, locale)}</span>
                  </p>
                  <p className="text-meta text-fg-subtle">
                    {formatDateTime(row.changedAt, locale)}
                    {row.changedBy ? (
                      <>
                        {" · "}
                        <PersonLink memberId={row.changedByMemberId} name={row.changedBy} />
                      </>
                    ) : null}
                  </p>
                  {row.reason ? <p className="text-meta text-fg-muted">{row.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="nesto-card p-5" aria-labelledby="status-history">
          <h2 id="status-history" className="nesto-section-head">
            {t("unitSales.statusHistory")}
          </h2>
          {sales.statusHistory.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">{t("unitSales.notForSaleSinceCreated")}</p>
          ) : (
            <ol className="mt-3 divide-y divide-line" data-testid="status-history">
              {sales.statusHistory.map((row) => (
                <li key={row.id} className="py-2 text-table">
                  <p className="text-fg">
                    {row.fromStatus ? `${salesLabel(t, "commercialStatus", row.fromStatus, UNIT_COMMERCIAL_STATUS_LABELS[row.fromStatus])} → ` : ""}
                    <span className="font-medium">{salesLabel(t, "commercialStatus", row.toStatus, UNIT_COMMERCIAL_STATUS_LABELS[row.toStatus])}</span>
                  </p>
                  <p className="text-meta text-fg-subtle">
                    {formatDateTime(row.changedAt, locale)} · {row.actor ? <PersonLink memberId={row.actorMemberId} name={row.actor} /> : salesLabel(t, "commercialSource", row.source, COMMERCIAL_SOURCE_LABELS[row.source])}
                  </p>
                  {row.reason ? <p className="text-meta text-fg-muted">{row.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <PriceDialog open={open === "price"} onClose={() => setOpen(null)} sales={sales} submit={submit} />
      {/* A sale's approval, where the company's Sold rule asks for one (E-05F §42). */}
      <FieldsDialog open={open === "requestApproval"} onClose={() => setOpen(null)} title={t("unitSales.requestTitle", { unit: sales.unitLabel })} description={t("unitSales.requestDescription")} confirmLabel={t("unitSales.askForApproval")} url={`/api/project-units/${sales.unitId}/sale-approval`} fields={[{ name: "note", label: t("unitSales.noteForApprover"), kind: "textarea" }]} success={t("unitSales.requestSuccess")} submit={submit} testId="request-sale-approval-dialog" />
      <FieldsDialog open={open === "approveSale"} onClose={() => setOpen(null)} title={t("unitSales.approveTitle", { unit: sales.unitLabel })} description={t("unitSales.approveDescription")} confirmLabel={t("unitSales.approve")} url={`/api/project-units/${sales.unitId}/sale-approval/approve`} fields={[{ name: "note", label: t("unitSales.note"), kind: "textarea" }]} success={t("unitSales.approveSuccess")} submit={submit} />
      <FieldsDialog open={open === "rejectSale"} onClose={() => setOpen(null)} title={t("unitSales.rejectTitle", { unit: sales.unitLabel })} confirmLabel={t("unitSales.reject")} url={`/api/project-units/${sales.unitId}/sale-approval/reject`} fields={[{ name: "note", label: t("unitSales.reason"), kind: "textarea", required: true }]} success={t("unitSales.rejectSuccess")} submit={submit} />
      <ReopenDialog open={open === "reopen"} onClose={() => setOpen(null)} sales={sales} submit={submit} />
      <CorrectDialog open={open === "correct"} onClose={() => setOpen(null)} sales={sales} submit={submit} />
      {/* Put on sale, take off sale, hold, release the hold, reserve, extend and release: the side panel's dialogs too (2026-11-09). */}
      <SaleStatusDialogs open={open} onClose={() => setOpen(null)} sales={sales} submit={submit} />
      <ConfirmDialog
        open={open === "sold"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={t("unitSales.soldTitle", { unit: sales.unitLabel })}
        description={t("unitSales.soldDescription", { client: reservation?.client?.name ?? t("unitSales.theClient"), price: moneyLabel(reservation?.agreedPrice ?? null, reservation?.currency ?? null, locale) })}
        confirmLabel={t("unitSales.markSold")}
        destructive={false}
        pending={pending}
        onConfirm={() => void markSold()}
      />
      <Dialog open={open === "notSold"} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-w-md" data-testid="not-sellable-dialog">
          <DialogTitle>{t("unitSales.cannotSellTitle", { unit: sales.unitLabel })}</DialogTitle>
          <DialogDescription>{t("unitSales.cannotSellDescription", { rule: salesLabel(t, "soldRule", sales.soldCheck.rule, UNIT_SOLD_RULE_LABELS[sales.soldCheck.rule]).toLowerCase() })}</DialogDescription>
          <ul className="mt-3 space-y-2">
            {sales.soldCheck.missing.map((item) => (
              <li key={item} className="flex items-start gap-2 text-table">
                <CircleX className="mt-0.5 size-4 shrink-0 text-danger-strong" aria-hidden="true" />
                <span className="font-medium text-fg">{soldMissingText(t, item)}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setOpen(null)}>{t("unitSales.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActiveReservation({ reservation }: { reservation: ReservationDTO }) {
  const locale = useLocale();
  const expires = new Date(reservation.expiresAt);
  const left = expires.getTime() - Date.now();
  const soon = left < 86_400_000;
  const t = useSalesTranslations();
  return (
    <section className="nesto-card p-5" aria-labelledby="active-reservation" data-testid="active-reservation">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="active-reservation" className="nesto-section-head">
          {t("unitSales.reservation")}
        </h2>
        {/* Past its date and not yet closed by the expiry job, which runs every few minutes (§25). */}
        <Badge tone={soon ? "warning" : "info"}>{left <= 0 ? t("unitSales.expiredReleasing") : t("unitSales.expires", { when: formatRelativeTime(expires, locale) })}</Badge>
      </div>
      <DetailGrid
        className="mt-4"
        items={[
          { label: t("unitSales.client"), value: reservation.client ? <Link href={`/clients/${reservation.client.id}`} className="font-medium hover:underline" data-testid="reservation-client">{reservation.client.name}</Link> : t("unitSales.hidden") },
          { label: t("unitSales.deal"), value: reservation.deal ? <Link href={`/sales/opportunities/${reservation.deal.id}`} className="font-medium hover:underline" data-testid="reservation-deal">{reservation.deal.name}</Link> : t("unitSales.hidden") },
          { label: t("unitSales.reserved"), value: formatDate(reservation.reservedAt, locale) },
          { label: t("unitSales.expiresLabel"), value: <span data-testid="reservation-expires">{formatDateTime(reservation.expiresAt, locale)}</span> },
          { label: t("unitSales.salesperson"), value: reservation.salesperson ? <PersonLink memberId={reservation.salespersonMemberId} name={reservation.salesperson} /> : "—" },
          { label: t("unitSales.agreedPrice"), value: <span className="tabular-nums" data-testid="agreed-price">{moneyLabel(reservation.agreedPrice, reservation.currency, locale)}</span> },
        ]}
      />
      {reservation.notes ? <p className="mt-4 whitespace-pre-line text-table text-fg-muted">{reservation.notes}</p> : null}
      {reservation.extensions.length ? (
        <div className="mt-4">
          <p className="nesto-eyebrow text-fg-subtle">{t("unitSales.extensions")}</p>
          <ul className="mt-1 space-y-1">
            {reservation.extensions.map((extension) => (
              <li key={extension.extendedAt} className="text-meta text-fg-muted">
                {formatDate(extension.oldExpiresAt, locale)} → {formatDate(extension.newExpiresAt, locale)}
                {extension.extendedBy ? (
                  <>
                    {" · "}
                    <PersonLink memberId={extension.extendedByMemberId} name={extension.extendedBy} />
                  </>
                ) : null}{" "}
                — {extension.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * What the company's Sold rule asks of this sale, and where it stands (E-05F §42-§44):
 * the rule, the unit's contract, and the sale's approval where the rule asks for one.
 */
function SaleConditions({ sales, onOpen }: { sales: UnitSalesDTO; onOpen: (open: Open) => void }) {
  const approval = sales.saleApproval;
  const manual = sales.soldCheck.rule === "MANUAL_APPROVAL";
  const t = useSalesTranslations();
  if (sales.status !== "RESERVED" && !sales.contract) return null;
  return (
    <div className="mt-4 space-y-2 rounded-md border border-line bg-surface-muted px-3 py-2.5 text-table" data-testid="sale-conditions">
      <p className="text-fg-muted">
        {t("unitSales.soldRule")} <span className="font-medium text-fg">{salesLabel(t, "soldRule", sales.soldCheck.rule, UNIT_SOLD_RULE_LABELS[sales.soldCheck.rule])}</span>
        {sales.status === "RESERVED" ? (sales.soldCheck.allowed ? t("unitSales.met") : t("unitSales.missing", { items: sales.soldCheck.missing.map((item) => soldMissingText(t, item)).join(", ").toLowerCase() })) : ""}
      </p>
      {sales.contract ? (
        <p className="flex flex-wrap items-center gap-2 text-fg-muted">
          {t("unitSales.contract")}{" "}
          <Link href={`/projects/${sales.projectId}/units/${sales.unitId}/legal`} className="font-medium text-fg hover:underline" data-testid="sales-contract-link">
            {sales.contract.number}
          </Link>
          <UnitContractStatusBadge status={sales.contract.status} />
        </p>
      ) : null}
      {manual && sales.status === "RESERVED" ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="sale-approval">
          {approval ? (
            <Badge tone={approval.status === "APPROVED" ? "success" : approval.status === "PENDING" ? "warning" : "default"}>
              {approval.status === "PENDING" ? t("unitSales.waitingApproval") : approval.status === "APPROVED" ? t("unitSales.saleApproved") : approval.status === "REJECTED" ? t("unitSales.saleRejected") : t("unitSales.approvalCancelled")}
            </Badge>
          ) : (
            <span className="text-fg-muted">{t("unitSales.noApproval")}</span>
          )}
          {approval?.note ? <span className="text-meta text-fg-subtle">{approval.note}</span> : null}
          {sales.canRequestSaleApproval ? (
            <Button size="sm" variant="secondary" onClick={() => onOpen("requestApproval")}>
              {t("unitSales.askForApproval")}
            </Button>
          ) : null}
          {approval?.status === "PENDING" && sales.capabilities.canApproveSale ? (
            <>
              <Button size="sm" onClick={() => onOpen("approveSale")}>
                {t("unitSales.approveSale")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onOpen("rejectSale")}>
                {t("unitSales.reject")}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
