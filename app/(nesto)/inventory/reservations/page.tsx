import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { BookmarkCheck } from "lucide-react";

import {
  ExpireReservationsButton,
  ReservationRowActions,
} from "@/components/inventory/reservation-actions";
import { InventoryExportLink } from "@/components/inventory/export-link";
import { ReservationTable } from "@/components/inventory/reservation-table";
import { ListToolbar, type FilterConfig } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/loading-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import * as reservations from "@/lib/modules/inventory/reservations/reservation.service";
import { reservationListQuerySchema } from "@/lib/modules/inventory/inventory.schema";
import {
  RESERVATION_STATUSES,
  reservationStatusLabels,
} from "@/lib/modules/inventory/inventory.status";

export const metadata: Metadata = { title: "Reservations" };

type SearchParams = Record<string, string | string[] | undefined>;

/** Stock promised but not yet moved (PRD #20 §152, §319). */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.reservation.view")) redirect("/access-denied");

  const experience = resolveModuleExperience(context, "inventory");
  const params = await searchParams;

  return (
    <ModulePage
      experience={experience}
      activeSection="reservations"
      actions={
        <>
          {can(context, "inventory.export") ? (
            <InventoryExportLink type="reservations" />
          ) : null}
          {can(context, "inventory.reservation.release") ? <ExpireReservationsButton /> : null}
          {can(context, "inventory.reservation.create") ? (
            <Button asChild size="sm">
              <Link href="/inventory/reservations/new">New reservation</Link>
            </Button>
          ) : null}
        </>
      }
    >
      <Suspense fallback={<SkeletonTable rows={8} />}>
        <ReservationList context={context} searchParams={params} />
      </Suspense>
    </ModulePage>
  );
}

async function ReservationList({
  context,
  searchParams,
}: {
  context: UserContext;
  searchParams: SearchParams;
}) {
  const read = (key: string) =>
    typeof searchParams[key] === "string" ? (searchParams[key] as string) : undefined;

  const statuses = read("status")
    ?.split(",")
    .filter((value) => (RESERVATION_STATUSES as readonly string[]).includes(value));

  const query = reservationListQuerySchema.parse({
    search: read("search"),
    status: statuses?.length ? statuses : undefined,
    warehouseId: read("warehouseId"),
    projectId: read("projectId"),
    inventoryItemId: read("inventoryItemId"),
    sort: read("sort"),
    page: read("page"),
  });

  const result = await reservations.listReservations(context, query);
  const hasFilters = Boolean(query.search || query.status?.length || query.warehouseId);

  const filters: FilterConfig[] = [
    {
      param: "status",
      label: "Status",
      options: RESERVATION_STATUSES.map((value) => ({
        value,
        label: reservationStatusLabels[value],
      })),
    },
  ];

  function buildHref(page: number) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && key !== "page") next.set(key, value);
    }
    if (page > 1) next.set("page", String(page));
    const search = next.toString();
    return search ? `/inventory/reservations?${search}` : "/inventory/reservations";
  }

  return (
    <div className="space-y-4">
      <ListToolbar
        searchPlaceholder="Search by number or item…"
        filters={filters}
        sortOptions={[
          { value: "created-desc", label: "Newest first" },
          { value: "required-asc", label: "Needed soonest" },
          { value: "expires-asc", label: "Expiring soonest" },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<BookmarkCheck />}
            title="No reservations match these filters."
            description="Adjust or clear the filters to see more."
            action={{ label: "Clear filters", href: "/inventory/reservations" }}
          />
        ) : (
          <EmptyState
            icon={<BookmarkCheck />}
            title="Nothing is reserved."
            description="A reservation holds stock back from available without moving it — the material stays exactly where it is, but it is already spoken for."
            action={
              can(context, "inventory.reservation.create")
                ? { label: "New reservation", href: "/inventory/reservations/new" }
                : undefined
            }
          />
        )
      ) : (
        <>
          <ReservationTable
            reservations={result.data}
            actions={(row) => <ReservationRowActions reservation={row} />}
          />
          <Pagination meta={result.pagination} buildHref={buildHref} />
        </>
      )}
    </div>
  );
}
