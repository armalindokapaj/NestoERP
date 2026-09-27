"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  expireReservationsAction,
  reservationLifecycleAction,
} from "@/lib/actions/inventory";
import type { ReservationDTO } from "@/lib/modules/inventory/inventory.types";
import { useInventoryTranslations } from "./inventory-text";

/**
 * Release and cancel (PRD #20 §161, §162).
 *
 * Both stop the reservation holding stock back, and the difference is why: a
 * release means the material is no longer needed, a cancellation means the
 * reservation should not have existed. Stock on hand never changes either way —
 * a reservation only ever moved the available figure (PRD #20 §166).
 */
export function ReservationRowActions({ reservation }: { reservation: ReservationDTO }) {
  const router = useRouter();
  const toast = useToast();
  const t = useInventoryTranslations();
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState<"release" | "cancel" | null>(null);

  const may = reservation.capabilities;
  if (!may.canRelease && !may.canCancel) return null;

  function run(action: "release" | "cancel", success: string) {
    startTransition(async () => {
      const result = await reservationLifecycleAction(reservation.id, action);
      if (result.ok) {
        setConfirming(null);
        toast({ title: success, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {may.canRelease ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("release")}
        >
          {t("reservationActions.release")}
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("cancel")}
        >
          {t("reservationActions.cancel")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming === "release"}
        onOpenChange={(open) => setConfirming(open ? "release" : null)}
        title={t("reservationActions.releaseTitle", { number: reservation.reservationNumber })}
        description={t("reservationActions.releaseDescription")}
        confirmLabel={t("reservationActions.release")}
        cancelLabel={t("reservationActions.keep")}
        destructive={false}
        pending={pending}
        onConfirm={() => run("release", t("reservationActions.released"))}
      />

      <ConfirmDialog
        open={confirming === "cancel"}
        onOpenChange={(open) => setConfirming(open ? "cancel" : null)}
        title={t("reservationActions.cancelTitle", { number: reservation.reservationNumber })}
        description={t("reservationActions.cancelDescription")}
        confirmLabel={t("reservationActions.cancelConfirm")}
        cancelLabel={t("reservationActions.keep")}
        pending={pending}
        onConfirm={() => run("cancel", t("reservationActions.cancelled"))}
      />
    </div>
  );
}

/** Releases everything past its expiry date in one go (PRD #20 §163). */
export function ExpireReservationsButton() {
  const router = useRouter();
  const toast = useToast();
  const t = useInventoryTranslations();
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await expireReservationsAction();
          if (result.ok) {
            const released = result.count ?? 0;
            toast({
              title: released === 0 ? t("reservationActions.nothingExpired") : t("reservationActions.expiredReleased", { count: released }),
              tone: "success",
            });
            router.refresh();
          } else {
            toast({ title: result.error, tone: "danger" });
          }
        })
      }
    >
      {pending ? t("reservationActions.releasing") : t("reservationActions.releaseExpired")}
    </Button>
  );
}
