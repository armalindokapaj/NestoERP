import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
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
import { listPageRedirect, pageHref } from "@/lib/modules/shared/list-query";
import { inventoryLabel } from "@/components/inventory/inventory-labels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inventory");
  return { title: t("meta.reservations") };
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Stock promised but not yet moved (PRD #20 §152, §319). */
export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await requireModule("inventory");
  if (!can(context, "inventory.reservation.view")) redirect("/access-denied");

  const t = await getTranslations("inventory");
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
              <Link href="/inventory/reservations/new">{t("meta.newReservation")}</Link>
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
  const t = await getTranslations("inventory");
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
      label: t("columns.status"),
      options: RESERVATION_STATUSES.map((value) => ({
        value,
        label: inventoryLabel(t, "reservationStatus", value, reservationStatusLabels[value]),
      })),
    },
  ];

  // A page past the end moves once to the last real page (AUD-08 §4, DT-05).
  if (result.pagination.page !== query.page) redirect(listPageRedirect("/inventory/reservations", searchParams, result.pagination.page));
  const buildHref = (page: number) => pageHref("/inventory/reservations", searchParams, page);

  return (
    <div className="space-y-4">
      <ListToolbar
        // English: "Search by reservation number…" (AUD-05 §5).
        searchPlaceholder={t("reservations.search")}
        filters={filters}
        sortOptions={[
          { value: "created-desc", label: t("sort.newest") },
          { value: "required-asc", label: t("sort.neededSoonest") },
          { value: "expires-asc", label: t("sort.expiringSoonest") },
        ]}
      />

      {result.data.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<BookmarkCheck />}
            title={t("reservations.noMatch")}
            description={t("empty.noMatchDescription")}
            action={{ label: t("empty.clearFilters"), href: "/inventory/reservations" }}
          />
        ) : (
          <EmptyState
            icon={<BookmarkCheck />}
            title={t("reservations.emptyTitle")}
            description={t("reservations.emptyDescription")}
            action={
              can(context, "inventory.reservation.create")
                ? { label: t("meta.newReservation"), href: "/inventory/reservations/new" }
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
