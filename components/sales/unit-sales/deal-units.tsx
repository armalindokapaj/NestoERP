import Link from "@/components/navigation/nav-link";

import type { UserContext } from "@/lib/context/types";
import { listDealUnits } from "@/lib/modules/sales/units/unit-sales.service";
import { UNIT_RESERVATION_STATUS_LABELS, type UnitReservationStatus } from "@/lib/modules/sales/units/unit-sales.types";
import { formatDate } from "@/lib/utils/format";
import { CommercialStatusBadge, moneyLabel } from "./commercial-status";
import { DealUnitRemove } from "./deal-unit-remove";

/**
 * The units in a deal (E-05E §17, §18): an apartment, its parking and its
 * storage, each still its own unit with its own status. Only the units the
 * reader may open are listed; each opens the unit's Sales section. A unit the
 * deal holds reserved or sold cannot be taken out here.
 */
export async function DealUnits({ context, opportunityId, canEdit }: { context: UserContext; opportunityId: string; canEdit: boolean }) {
  const units = await listDealUnits(context, opportunityId);
  return (
    <section className="nesto-card p-5" aria-labelledby="deal-units" data-testid="deal-units">
      <h2 id="deal-units" className="text-card font-semibold text-fg">
        Units
      </h2>
      {units.length === 0 ? (
        <p className="mt-3 text-table text-fg-muted">No units yet. A unit joins this opportunity when it is reserved for it, from the unit&apos;s Sales section.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {units.map((unit) => {
            const held = unit.reservation?.status === "ACTIVE" || unit.reservation?.status === "CONVERTED_TO_SALE";
            return (
              <li key={unit.unitId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-table" data-testid="deal-unit" data-unit-code={unit.unitCode}>
                <Link href={unit.href} className="font-medium text-fg hover:underline">
                  {unit.unitCode}
                </Link>
                <span className="text-fg-muted">
                  {unit.unitType} · {unit.projectName} · {unit.building} · {unit.floor}
                </span>
                <CommercialStatusBadge status={unit.status} />
                {unit.reservation ? (
                  <span className="text-meta text-fg-subtle">
                    {UNIT_RESERVATION_STATUS_LABELS[unit.reservation.status as UnitReservationStatus]}
                    {unit.reservation.status === "ACTIVE" ? ` until ${formatDate(unit.reservation.expiresAt)}` : ""}
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums text-fg">{moneyLabel(unit.agreedPrice, unit.currency)}</span>
                {canEdit && !held ? <DealUnitRemove opportunityId={opportunityId} unitId={unit.unitId} unitCode={unit.unitCode} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
