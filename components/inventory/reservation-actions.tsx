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
          Release
        </Button>
      ) : null}

      {may.canCancel ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setConfirming("cancel")}
        >
          Cancel
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming === "release"}
        onOpenChange={(open) => setConfirming(open ? "release" : null)}
        title={`Release ${reservation.reservationNumber}?`}
        description="The quantity goes back to available immediately. Nothing physically moves, and stock on hand is unchanged."
        confirmLabel="Release"
        cancelLabel="Keep it"
        destructive={false}
        pending={pending}
        onConfirm={() => run("release", "Reservation released.")}
      />

      <ConfirmDialog
        open={confirming === "cancel"}
        onOpenChange={(open) => setConfirming(open ? "cancel" : null)}
        title={`Cancel ${reservation.reservationNumber}?`}
        description="The reservation is closed and stops holding stock back. It stays on record as cancelled."
        confirmLabel="Cancel reservation"
        cancelLabel="Keep it"
        pending={pending}
        onConfirm={() => run("cancel", "Reservation cancelled.")}
      />
    </div>
  );
}

/** Releases everything past its expiry date in one go (PRD #20 §163). */
export function ExpireReservationsButton() {
  const router = useRouter();
  const toast = useToast();
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
            toast({ title: result.message ?? "Done.", tone: "success" });
            router.refresh();
          } else {
            toast({ title: result.error, tone: "danger" });
          }
        })
      }
    >
      {pending ? "Releasing…" : "Release expired"}
    </Button>
  );
}
