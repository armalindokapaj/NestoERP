"use client";

import * as React from "react";

import { useLocale } from "@/components/i18n/i18n-provider";
import { failureMessage } from "@/components/project-structure/structure-ui";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/i18n/format";
import type { UnitSalesDTO } from "@/lib/modules/sales/units/unit-sales.types";
import { dateValue, ReasonDialog, ReserveDialog } from "./unit-sales-dialogs";

/**
 * The sale-status changes a unit is offered both on its Sales section and in
 * the unit side panel (2026-11-09): put on sale, take off sale, hold, release
 * the hold, reserve, extend and release the reservation. One set of dialogs,
 * so the two places ask the same questions and send the same requests.
 */

export type SaleStatusDialog = "putOnSale" | "takeOff" | "hold" | "releaseHold" | "reserve" | "extend" | "release";

type Submit = (url: string, body: Record<string, unknown>, success: string) => Promise<unknown>;

export function SaleStatusDialogs({ open, onClose, sales, submit }: { open: string | null; onClose: () => void; sales: UnitSalesDTO; submit: Submit }) {
  const t = useSalesTranslations();
  const locale = useLocale();
  const toast = useToast();
  const [pending, setPending] = React.useState(false);
  const reservation = sales.activeReservation;
  const expected = sales.version > 0 ? { expectedVersion: sales.version } : {};

  async function quick(action: "put_on_sale" | "take_off_sale" | "release_hold", success: string) {
    setPending(true);
    try {
      await submit(`/api/project-units/${sales.unitId}/sales/status`, { action, ...expected }, success);
      onClose();
    } catch (error) {
      onClose();
      toast({ title: failureMessage(error, t("unitSales.failed")), tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <ReserveDialog open={open === "reserve"} onClose={onClose} sales={sales} submit={submit} />
      <ReasonDialog
        open={open === "hold"}
        onClose={onClose}
        title={t("unitSales.holdTitle", { unit: sales.unitLabel })}
        description={t("unitSales.holdDescription")}
        confirmLabel={t("unitSales.hold")}
        url={`/api/project-units/${sales.unitId}/sales/status`}
        body={{ action: "hold", ...expected }}
        success={t("unitSales.holdSuccess", { unit: sales.unitLabel })}
        submit={submit}
        date={{ label: t("unitSales.reviewHoldOn"), field: "holdUntil", required: false, min: dateValue(new Date()) }}
        testId="hold-dialog"
      />
      {reservation ? (
        <>
          <ReasonDialog
            open={open === "extend"}
            onClose={onClose}
            title={t("unitSales.extendTitle", { unit: sales.unitLabel })}
            description={t("unitSales.extendDescription", { date: formatDate(reservation.expiresAt, locale) })}
            confirmLabel={t("unitSales.extend")}
            url={`/api/unit-reservations/${reservation.id}/extend`}
            body={{ expectedVersion: reservation.version }}
            success={t("unitSales.extendSuccess", { unit: sales.unitLabel })}
            submit={submit}
            date={{ label: t("unitSales.newExpiry"), field: "expiresAt", required: true, initial: dateValue(new Date(new Date(reservation.expiresAt).getTime() + sales.defaults.reservationDays * 86_400_000)), min: dateValue(reservation.expiresAt) }}
            testId="extend-dialog"
          />
          <ReasonDialog
            open={open === "release"}
            onClose={onClose}
            title={t("unitSales.releaseTitle", { unit: sales.unitLabel })}
            description={t("unitSales.releaseDescription")}
            confirmLabel={t("unitSales.release")}
            url={`/api/unit-reservations/${reservation.id}/release`}
            body={{ expectedVersion: reservation.version }}
            success={t("unitSales.releaseSuccess", { unit: sales.unitLabel })}
            submit={submit}
            testId="release-dialog"
          />
        </>
      ) : null}
      <ConfirmDialog open={open === "putOnSale"} onOpenChange={(value) => !value && onClose()} title={t("unitSales.putOnSaleTitle", { unit: sales.unitLabel })} description={t("unitSales.putOnSaleDescription")} confirmLabel={t("unitSales.putOnSale")} destructive={false} pending={pending} onConfirm={() => void quick("put_on_sale", t("unitSales.forSale", { unit: sales.unitLabel }))} />
      <ConfirmDialog open={open === "takeOff"} onOpenChange={(value) => !value && onClose()} title={t("unitSales.takeOffTitle", { unit: sales.unitLabel })} description={t("unitSales.takeOffDescription")} confirmLabel={t("unitSales.takeOffSale")} pending={pending} onConfirm={() => void quick("take_off_sale", t("unitSales.noLongerForSale", { unit: sales.unitLabel }))} />
      <ConfirmDialog open={open === "releaseHold"} onOpenChange={(value) => !value && onClose()} title={t("unitSales.releaseHoldTitle", { unit: sales.unitLabel })} description={t("unitSales.releaseHoldDescription")} confirmLabel={t("unitSales.releaseHold")} destructive={false} pending={pending} onConfirm={() => void quick("release_hold", t("unitSales.forSaleAgain", { unit: sales.unitLabel }))} />
    </>
  );
}
