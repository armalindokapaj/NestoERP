import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { ReservationRowActions } from "@/components/inventory/reservation-actions";
import { MovementTable } from "@/components/inventory/movement-table";
import { formatQuantity } from "@/components/inventory/inventory-format";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import * as reservations from "@/lib/modules/inventory/reservations/reservation.service";
import { movementListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import { formatDate, formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ reservationId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { reservationId } = await params;
  try {
    const context = await requireModule("inventory");
    const reservation = await reservations.getReservation(context, reservationId);
    return { title: reservation.reservationNumber };
  } catch {
    const t = await getTranslations("inventory");
    return { title: t("meta.reservation") };
  }
}

/**
 * One reservation (PRD #20 §153, §165, §319).
 *
 * Stock on hand is untouched throughout its life: a reservation only ever moved
 * the *available* figure, so the material is still in the rack — it is just
 * already spoken for (PRD #20 §166).
 */
export default async function ReservationPage({ params }: Params) {
  const { reservationId } = await params;
  const context = await requireModule("inventory");
  const t = await getTranslations("inventory");

  let reservation;
  try {
    reservation = await reservations.getReservation(context, reservationId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // What has actually moved at this location, so a reader can see the stock the
  // reservation is holding against.
  const recent = can(context, "inventory.movement.view")
    ? (
        await movements.listMovements(
          context,
          movementListQuerySchema.parse({
            inventoryItemId: reservation.item.id,
            locationId: reservation.location.id,
            limit: 10,
          }),
        )
      ).data
    : [];

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("meta.inventory"), href: "/inventory" },
          { label: t("meta.reservations"), href: "/inventory/reservations" },
          { label: reservation.reservationNumber },
        ]}
        title={reservation.reservationNumber}
        subtitle={reservation.item.name}
        status={reservation.status}
        badges={
          <>
            {reservation.project ? (
              <Badge tone="info">{reservation.project.code}</Badge>
            ) : (
              <Badge tone="neutral">{t("detail.heldGenerally")}</Badge>
            )}
            {reservation.expired ? <Badge tone="warning">{t("columns.pastExpiry")}</Badge> : null}
          </>
        }
        meta={[
          {
            label: t("columns.reserved"),
            value: `${formatQuantity(reservation.quantity)} ${reservation.item.baseUnit}`,
          },
          {
            label: t("detail.stillHeld"),
            value: `${formatQuantity(reservation.remainingQuantity)} ${reservation.item.baseUnit}`,
          },
          {
            label: t("columns.required"),
            value: reservation.requiredDate ? formatDate(reservation.requiredDate) : "—",
          },
        ]}
        actions={<ReservationRowActions reservation={reservation} />}
      />

      <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
        {t("notice.reservation")}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: t("columns.item"),
                  value: (
                    <Link
                      href={`/inventory/items/${reservation.item.id}`}
                      className="hover:text-accent"
                    >
                      {reservation.item.sku} — {reservation.item.name}
                    </Link>
                  ),
                },
                {
                  label: t("fields.warehouse"),
                  value: (
                    <Link
                      href={`/inventory/warehouses/${reservation.warehouse.id}`}
                      className="hover:text-accent"
                    >
                      {reservation.warehouse.name}
                    </Link>
                  ),
                },
                { label: t("columns.location"), value: reservation.location.code },
                {
                  label: t("fields.project"),
                  value: reservation.project
                    ? `${reservation.project.code} — ${reservation.project.name}`
                    : t("detail.noProject"),
                },
                {
                  label: t("detail.takenSoFar"),
                  value: `${formatQuantity(reservation.fulfilledQuantity)} ${reservation.item.baseUnit}`,
                },
                {
                  label: t("fields.expires"),
                  value: reservation.expiresAt ? formatDate(reservation.expiresAt) : t("detail.noExpiry"),
                },
              ]}
            />
          </section>

          {recent.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("detail.recentMovements")}</h2>
              <MovementTable
                movements={recent}
                showItem={false}
                caption={t("detail.movementsOfAt", { name: reservation.item.name, location: reservation.location.code })}
                listId="inventory.reservation-movements"
              />
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <dl className="mt-4 space-y-3">
              <Meta label={t("detail.reservedBy")} value={reservation.createdBy ? <PersonLink memberId={reservation.createdBy.memberId} name={reservation.createdBy.fullName} /> : "—"} />
              <Meta label={t("detail.created")} value={formatDateTime(reservation.createdAt)} />
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 text-table text-fg">{value}</dd>
    </div>
  );
}
