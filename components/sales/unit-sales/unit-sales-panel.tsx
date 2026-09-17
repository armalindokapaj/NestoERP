"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BadgeCheck, CalendarPlus, CircleX, MoreHorizontal, PauseCircle, PlayCircle, Tag, Undo2, Unlock } from "lucide-react";

import { DetailGrid } from "@/components/modules/record-header";
import { areaText, structureApi } from "@/components/project-structure/structure-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { COMMERCIAL_SOURCE_LABELS, UNIT_COMMERCIAL_STATUS_LABELS, UNIT_PRICE_BASIS_LABELS, UNIT_RESERVATION_STATUS_LABELS, type ReservationDTO, type UnitSalesDTO } from "@/lib/modules/sales/units/unit-sales.types";
import { failureMessage } from "@/components/project-structure/structure-ui";
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/utils/format";
import { CommercialStatusBadge, moneyLabel, perSqmLabel } from "./commercial-status";
import { CorrectDialog, dateValue, PriceDialog, ReasonDialog, ReopenDialog, ReserveDialog } from "./unit-sales-dialogs";

/**
 * A unit's Sales section (E-05E §15, §19-§31, §55): where the sale stands, the
 * actions the reader may take on it now, and every price, reservation and status
 * it has had. The same page every module opens — there is no Sales unit page.
 * `?action=reserve` or `?action=release` (from the inventory's phone cards)
 * opens that dialog, when the reader may take it.
 */

type Open = "price" | "hold" | "reserve" | "extend" | "release" | "sold" | "notSold" | "reopen" | "correct" | "putOnSale" | "takeOff" | "releaseHold" | null;

export function UnitSalesPanel({ sales, initialAction }: { sales: UnitSalesDTO; initialAction?: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const caps = sales.capabilities;
  const reservation = sales.activeReservation;
  const [open, setOpen] = React.useState<Open>(null);
  const [pending, setPending] = React.useState(false);

  const status = sales.status;
  const offer = {
    putOnSale: caps.canManageStatus && status === "NOT_FOR_SALE" && sales.sellable,
    takeOff: caps.canManageStatus && status === "FOR_SALE",
    hold: caps.canManageStatus && status === "FOR_SALE",
    releaseHold: caps.canManageStatus && status === "ON_HOLD",
    reserve: caps.canReserve && (status === "FOR_SALE" || status === "ON_HOLD") && sales.sellable,
    extend: caps.canExtend && Boolean(reservation),
    release: caps.canRelease && Boolean(reservation),
    sold: caps.canMarkSold && status === "RESERVED",
    reopen: caps.canReopen && status === "SOLD",
    correct: caps.canCorrect && Boolean(reservation),
    price: caps.canManagePrice && status !== "SOLD",
  };

  React.useEffect(() => {
    if (initialAction === "reserve" && offer.reserve) setOpen("reserve");
    if (initialAction === "release" && offer.release) setOpen("release");
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = React.useCallback(
    async (url: string, body: Record<string, unknown>, success: string) => {
      await structureApi(url, { method: url.endsWith("/sales") ? "PATCH" : "POST", body });
      toast({ title: success });
      if (initialAction) router.replace(pathname, { scroll: false });
      router.refresh();
    },
    [toast, router, pathname, initialAction],
  );

  async function quick(action: "put_on_sale" | "take_off_sale" | "release_hold", success: string) {
    setPending(true);
    try {
      await submit(`/api/project-units/${sales.unitId}/sales/status`, { action, ...(sales.version > 0 ? { expectedVersion: sales.version } : {}) }, success);
      setOpen(null);
    } catch (error) {
      setOpen(null);
      toast({ title: failureMessage(error, "That did not work. Try again."), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  async function markSold() {
    setPending(true);
    try {
      await submit(`/api/project-units/${sales.unitId}/mark-sold`, sales.version > 0 ? { expectedVersion: sales.version } : {}, `${sales.unitCode} is sold.`);
      setOpen(null);
    } catch (error) {
      setOpen(null);
      toast({ title: failureMessage(error, "The unit could not be marked Sold."), tone: "danger" });
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
            <h2 id="unit-sales-summary" className="text-card font-semibold text-fg">
              Sales
            </h2>
            <CommercialStatusBadge status={status} />
            {sales.statusChangedAt ? <span className="text-meta text-fg-subtle">since {formatDate(sales.statusChangedAt)}</span> : null}
          </div>

          {!sales.sellable && (status === "NOT_FOR_SALE" || status === "FOR_SALE" || status === "ON_HOLD") ? (
            <p className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-table text-warning-strong" data-testid="unit-not-sellable">
              {sales.sellableReason} It can be put on sale and reserved once the Architecture team publishes it.
            </p>
          ) : null}

          <DetailGrid
            className="mt-4"
            items={[
              { label: "Asking price", value: <span className="tabular-nums" data-testid="asking-price">{moneyLabel(sales.askingPrice, sales.currency)}</span> },
              { label: "Price/m²", value: <span className="tabular-nums" data-testid="price-per-sqm">{sales.priceBasis === "FIXED_UNIT_PRICE" ? "—" : perSqmLabel(sales.pricePerSqm, sales.currency)}</span> },
              { label: "Price basis", value: `${UNIT_PRICE_BASIS_LABELS[sales.priceBasis]}${sales.basisArea ? ` · ${areaText(sales.basisArea)}` : ""}` },
              ...(status === "ON_HOLD" ? [{ label: "Held", value: `${sales.heldBy ?? "—"}${sales.holdUntil ? ` · until ${formatDate(sales.holdUntil)}` : ""}` }] : []),
            ]}
          />
          {status === "ON_HOLD" && sales.holdReason ? (
            <div className="mt-4">
              <p className="nesto-eyebrow text-fg-subtle">Hold reason</p>
              <p className="mt-1 whitespace-pre-line text-table text-fg">{sales.holdReason}</p>
            </div>
          ) : null}
          {sales.salesNotes ? (
            <div className="mt-4">
              <p className="nesto-eyebrow text-fg-subtle">Sales notes</p>
              <p className="mt-1 whitespace-pre-line text-table text-fg">{sales.salesNotes}</p>
            </div>
          ) : null}

          {Object.values(offer).some(Boolean) ? (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4" data-testid="unit-sales-actions">
              {offer.putOnSale ? (
                <Button onClick={() => setOpen("putOnSale")} disabled={pending}>
                  <PlayCircle aria-hidden="true" /> Put on sale
                </Button>
              ) : null}
              {offer.reserve ? (
                <Button onClick={() => setOpen("reserve")} disabled={pending}>
                  <BadgeCheck aria-hidden="true" /> Reserve
                </Button>
              ) : null}
              {offer.sold ? (
                <Button onClick={() => setOpen(sales.soldCheck.allowed ? "sold" : "notSold")} disabled={pending}>
                  <BadgeCheck aria-hidden="true" /> Mark Sold
                </Button>
              ) : null}
              {offer.extend ? (
                <Button variant="secondary" onClick={() => setOpen("extend")} disabled={pending}>
                  <CalendarPlus aria-hidden="true" /> Extend
                </Button>
              ) : null}
              {offer.release ? (
                <Button variant="secondary" onClick={() => setOpen("release")} disabled={pending}>
                  <Unlock aria-hidden="true" /> Release
                </Button>
              ) : null}
              {offer.hold ? (
                <Button variant="secondary" onClick={() => setOpen("hold")} disabled={pending}>
                  <PauseCircle aria-hidden="true" /> Hold
                </Button>
              ) : null}
              {offer.releaseHold ? (
                <Button variant="secondary" onClick={() => setOpen("releaseHold")} disabled={pending}>
                  <PlayCircle aria-hidden="true" /> Release hold
                </Button>
              ) : null}
              {offer.reopen ? (
                <Button variant="secondary" onClick={() => setOpen("reopen")} disabled={pending}>
                  <Undo2 aria-hidden="true" /> Reopen sale
                </Button>
              ) : null}
              {offer.price ? (
                <Button variant="secondary" onClick={() => setOpen("price")} disabled={pending}>
                  <Tag aria-hidden="true" /> {sales.askingPrice ? "Change price" : "Set price"}
                </Button>
              ) : null}
              {menu ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="More sales actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {offer.correct ? <DropdownMenuItem onSelect={() => setOpen("correct")}>Correct reservation</DropdownMenuItem> : null}
                    {offer.takeOff ? <DropdownMenuItem onSelect={() => setOpen("takeOff")}>Take off sale</DropdownMenuItem> : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
        </section>

        {reservation ? <ActiveReservation reservation={reservation} /> : null}

        <section className="nesto-card p-5" aria-labelledby="reservation-history">
          <h2 id="reservation-history" className="text-card font-semibold text-fg">
            Reservations
          </h2>
          {sales.reservations.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">This unit has never been reserved.</p>
          ) : (
            <ol className="mt-3 divide-y divide-line" data-testid="reservation-history">
              {sales.reservations.map((row) => (
                <li key={row.id} className="py-2.5 text-table">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Badge tone={row.status === "ACTIVE" ? "info" : row.status === "CONVERTED_TO_SALE" ? "success" : "default"}>{UNIT_RESERVATION_STATUS_LABELS[row.status]}</Badge>
                    <span className="font-medium text-fg">{row.client?.name ?? "Client hidden"}</span>
                    {row.deal ? <span className="text-fg-muted">· {row.deal.name}</span> : null}
                    <span className="ml-auto tabular-nums text-fg-muted">{moneyLabel(row.agreedPrice, row.currency)}</span>
                  </div>
                  <p className="mt-0.5 text-meta text-fg-subtle">
                    {formatDate(row.reservedAt)} – {formatDate(row.closedAt ?? row.expiresAt)}
                    {row.salesperson ? ` · ${row.salesperson}` : ""}
                    {row.extensions.length ? ` · extended ${row.extensions.length === 1 ? "once" : `${row.extensions.length} times`}` : ""}
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
            <h2 id="unit-deals" className="text-card font-semibold text-fg">
              Deals
            </h2>
            <ul className="mt-3 space-y-2" data-testid="unit-deals">
              {sales.deals.map((deal) => (
                <li key={deal.id} className="flex items-baseline justify-between gap-2 text-table">
                  <Link href={`/sales/opportunities/${deal.id}`} className="truncate font-medium text-fg hover:underline">
                    {deal.name}
                  </Link>
                  <span className="tabular-nums text-fg-muted">{moneyLabel(deal.agreedPrice, deal.currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="nesto-card p-5" aria-labelledby="price-history">
          <h2 id="price-history" className="text-card font-semibold text-fg">
            Price history
          </h2>
          {sales.priceHistory.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">No price has been set.</p>
          ) : (
            <ol className="mt-3 divide-y divide-line" data-testid="price-history">
              {sales.priceHistory.map((row) => (
                <li key={row.id} className="py-2 text-table">
                  <p className="tabular-nums text-fg">
                    {row.oldPrice ? `${moneyLabel(row.oldPrice, row.oldCurrency)} → ` : ""}
                    <span className="font-medium">{moneyLabel(row.newPrice, row.currency)}</span>
                  </p>
                  <p className="text-meta text-fg-subtle">
                    {formatDateTime(row.changedAt)}
                    {row.changedBy ? ` · ${row.changedBy}` : ""}
                  </p>
                  {row.reason ? <p className="text-meta text-fg-muted">{row.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="nesto-card p-5" aria-labelledby="status-history">
          <h2 id="status-history" className="text-card font-semibold text-fg">
            Status history
          </h2>
          {sales.statusHistory.length === 0 ? (
            <p className="mt-3 text-table text-fg-muted">Not For Sale since it was created.</p>
          ) : (
            <ol className="mt-3 divide-y divide-line" data-testid="status-history">
              {sales.statusHistory.map((row) => (
                <li key={row.id} className="py-2 text-table">
                  <p className="text-fg">
                    {row.fromStatus ? `${UNIT_COMMERCIAL_STATUS_LABELS[row.fromStatus]} → ` : ""}
                    <span className="font-medium">{UNIT_COMMERCIAL_STATUS_LABELS[row.toStatus]}</span>
                  </p>
                  <p className="text-meta text-fg-subtle">
                    {formatDateTime(row.changedAt)} · {row.actor ?? COMMERCIAL_SOURCE_LABELS[row.source]}
                  </p>
                  {row.reason ? <p className="text-meta text-fg-muted">{row.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <PriceDialog open={open === "price"} onClose={() => setOpen(null)} sales={sales} submit={submit} />
      <ReserveDialog open={open === "reserve"} onClose={() => setOpen(null)} sales={sales} submit={submit} />
      <ReopenDialog open={open === "reopen"} onClose={() => setOpen(null)} sales={sales} submit={submit} />
      <CorrectDialog open={open === "correct"} onClose={() => setOpen(null)} sales={sales} submit={submit} />
      <ReasonDialog
        open={open === "hold"}
        onClose={() => setOpen(null)}
        title={`Hold ${sales.unitCode}`}
        description="A held unit cannot be offered until the hold is released. It can still be reserved by someone allowed to."
        confirmLabel="Hold"
        url={`/api/project-units/${sales.unitId}/sales/status`}
        body={{ action: "hold", ...(sales.version > 0 ? { expectedVersion: sales.version } : {}) }}
        success={`${sales.unitCode} is on hold.`}
        submit={submit}
        date={{ label: "Review the hold on", field: "holdUntil", required: false, min: dateValue(new Date()) }}
        testId="hold-dialog"
      />
      {reservation ? (
        <>
          <ReasonDialog
            open={open === "extend"}
            onClose={() => setOpen(null)}
            title={`Extend the reservation of ${sales.unitCode}`}
            description={`It now expires on ${formatDate(reservation.expiresAt)}. The old and new dates are both kept.`}
            confirmLabel="Extend"
            url={`/api/unit-reservations/${reservation.id}/extend`}
            body={{ expectedVersion: reservation.version }}
            success={`The reservation of ${sales.unitCode} was extended.`}
            submit={submit}
            date={{ label: "New expiry date", field: "expiresAt", required: true, initial: dateValue(new Date(new Date(reservation.expiresAt).getTime() + sales.defaults.reservationDays * 86_400_000)), min: dateValue(reservation.expiresAt) }}
            testId="extend-dialog"
          />
          <ReasonDialog
            open={open === "release"}
            onClose={() => setOpen(null)}
            title={`Release the reservation of ${sales.unitCode}?`}
            description="The unit goes back on sale. The reservation stays in the history."
            confirmLabel="Release"
            url={`/api/unit-reservations/${reservation.id}/release`}
            body={{ expectedVersion: reservation.version }}
            success={`The reservation of ${sales.unitCode} was released.`}
            submit={submit}
            testId="release-dialog"
          />
        </>
      ) : null}

      <ConfirmDialog open={open === "putOnSale"} onOpenChange={(value) => !value && setOpen(null)} title={`Put ${sales.unitCode} on sale?`} description="Sales can offer and reserve it from now on." confirmLabel="Put on sale" destructive={false} pending={pending} onConfirm={() => void quick("put_on_sale", `${sales.unitCode} is for sale.`)} />
      <ConfirmDialog open={open === "takeOff"} onOpenChange={(value) => !value && setOpen(null)} title={`Take ${sales.unitCode} off sale?`} description="It stops being offered. Its price and history are kept." confirmLabel="Take off sale" pending={pending} onConfirm={() => void quick("take_off_sale", `${sales.unitCode} is no longer for sale.`)} />
      <ConfirmDialog open={open === "releaseHold"} onOpenChange={(value) => !value && setOpen(null)} title={`Release the hold on ${sales.unitCode}?`} description="The unit is for sale again." confirmLabel="Release hold" destructive={false} pending={pending} onConfirm={() => void quick("release_hold", `${sales.unitCode} is for sale again.`)} />
      <ConfirmDialog
        open={open === "sold"}
        onOpenChange={(value) => !value && setOpen(null)}
        title={`Mark ${sales.unitCode} Sold?`}
        description={`The reservation for ${reservation?.client?.name ?? "the client"} becomes the sale, at ${moneyLabel(reservation?.agreedPrice ?? null, reservation?.currency ?? null)}. Only a Sales Manager can reopen it.`}
        confirmLabel="Mark Sold"
        destructive={false}
        pending={pending}
        onConfirm={() => void markSold()}
      />
      <Dialog open={open === "notSold"} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-w-md" data-testid="not-sellable-dialog">
          <DialogTitle>{sales.unitCode} cannot be marked Sold yet</DialogTitle>
          <DialogDescription>Complete these first:</DialogDescription>
          <ul className="mt-3 space-y-2">
            {sales.soldCheck.missing.map((item) => (
              <li key={item} className="flex items-start gap-2 text-table">
                <CircleX className="mt-0.5 size-4 shrink-0 text-danger-strong" aria-hidden="true" />
                <span className="font-medium text-fg">{item}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setOpen(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActiveReservation({ reservation }: { reservation: ReservationDTO }) {
  const expires = new Date(reservation.expiresAt);
  const left = expires.getTime() - Date.now();
  const soon = left < 86_400_000;
  return (
    <section className="nesto-card p-5" aria-labelledby="active-reservation" data-testid="active-reservation">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="active-reservation" className="text-card font-semibold text-fg">
          Reservation
        </h2>
        {/* Past its date and not yet closed by the expiry job, which runs every few minutes (§25). */}
        <Badge tone={soon ? "warning" : "info"}>{left <= 0 ? "Expired — being released" : `Expires ${formatRelativeTime(expires)}`}</Badge>
      </div>
      <DetailGrid
        className="mt-4"
        items={[
          { label: "Client", value: reservation.client ? <Link href={`/clients/${reservation.client.id}`} className="font-medium hover:underline" data-testid="reservation-client">{reservation.client.name}</Link> : "Hidden" },
          { label: "Deal", value: reservation.deal ? <Link href={`/sales/opportunities/${reservation.deal.id}`} className="font-medium hover:underline" data-testid="reservation-deal">{reservation.deal.name}</Link> : "Hidden" },
          { label: "Reserved", value: formatDate(reservation.reservedAt) },
          { label: "Expires", value: <span data-testid="reservation-expires">{formatDateTime(reservation.expiresAt)}</span> },
          { label: "Salesperson", value: reservation.salesperson ?? "—" },
          { label: "Agreed price", value: <span className="tabular-nums" data-testid="agreed-price">{moneyLabel(reservation.agreedPrice, reservation.currency)}</span> },
        ]}
      />
      {reservation.notes ? <p className="mt-4 whitespace-pre-line text-table text-fg-muted">{reservation.notes}</p> : null}
      {reservation.extensions.length ? (
        <div className="mt-4">
          <p className="nesto-eyebrow text-fg-subtle">Extensions</p>
          <ul className="mt-1 space-y-1">
            {reservation.extensions.map((extension) => (
              <li key={extension.extendedAt} className="text-meta text-fg-muted">
                {formatDate(extension.oldExpiresAt)} → {formatDate(extension.newExpiresAt)}
                {extension.extendedBy ? ` · ${extension.extendedBy}` : ""} — {extension.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
