import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";

import { DataTable, type TableColumn } from "@/components/data/data-table";
import { IssueTable, ReturnTable } from "@/components/inventory/document-tables";
import { MovementTable } from "@/components/inventory/movement-table";
import { ReservationTable } from "@/components/inventory/reservation-table";
import { formatQuantity } from "@/components/inventory/inventory-format";
import { RecordContextHeader } from "@/components/modules/record-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import * as issues from "@/lib/modules/inventory/documents/issue.service";
import * as returns from "@/lib/modules/inventory/documents/return.service";
import * as movements from "@/lib/modules/inventory/movements/movement.service";
import * as reservations from "@/lib/modules/inventory/reservations/reservation.service";
import { projectConsumption } from "@/lib/modules/inventory/reports/reports.service";
import {
  movementListQuerySchema,
  reservationListQuerySchema,
  transactionListQuerySchema,
} from "@/lib/modules/inventory/inventory.schema";
import type { ProjectConsumptionRow } from "@/lib/modules/inventory/inventory.types";
import * as projects from "@/lib/modules/projects/project.service";
import { loadProject, } from "../project-context";

type Params = { params: Promise<{ projectId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("inventoryTab.title") };
}

/**
 * Material on one project (PRD #20 §10, §182–§185).
 *
 * The same canonical Inventory records filtered by `projectId` — not a second
 * table. Being given a project does not by itself hand somebody its stock: the
 * tab needs an inventory permission, and every inventory scope narrows the rows
 * again on the way out (PRD #20 §299, §301).
 *
 * Consumption is issued less returned. A project that took forty bags and
 * brought six back consumed thirty-four, and reporting the forty would
 * overstate every job that ever returns anything (PRD #20 §185).
 */
export default async function ProjectInventoryPage({ params }: Params) {
  const { projectId } = await params;
  const { context, project } = await loadProject(projectId);
  const t = await getTranslations("projects");
  const actions = projects.projectActions(context);

  if (!actions.canViewInventory) redirect("/access-denied");

  // Returns, reservations and movements are previews of the latest 20; each
  // says how many there are in all, so none is cut short silently (AUD-08 §4).
  const [consumption, issueRows, returnList, reservationList, movementList] = await Promise.all([
    projectConsumption(context, projectId),
    issues.listForProject(context, projectId),
    can(context, "inventory.return.view")
      ? returns
          .listReturns(context, transactionListQuerySchema.parse({ projectId, limit: 20 }))
          .then((result) => ({ rows: result.data, total: result.pagination.total }))
      : Promise.resolve({ rows: [], total: 0 }),
    can(context, "inventory.reservation.view")
      ? reservations
          .listReservations(
            context,
            reservationListQuerySchema.parse({
              projectId,
              status: ["ACTIVE", "PARTIALLY_FULFILLED"],
              limit: 20,
            }),
          )
          .then((result) => ({ rows: result.data, total: result.pagination.total }))
      : Promise.resolve({ rows: [], total: 0 }),
    can(context, "inventory.movement.view")
      ? movements
          .listMovements(context, movementListQuerySchema.parse({ projectId, limit: 20 }))
          .then((result) => ({ rows: result.data, total: result.pagination.total }))
      : Promise.resolve({ rows: [], total: 0 }),
  ]);

  const returnRows = returnList.rows;
  const reservationRows = reservationList.rows;
  const movementRows = movementList.rows;
  const mayIssue = can(context, "inventory.issue.create");
  const consumptionColumns: TableColumn<ProjectConsumptionRow>[] = [
    {
      key: "item",
      label: t("inventoryTab.item"),
      primary: true,
      render: (row) => (
        <span className="flex flex-col">
          <Link
            href={`/inventory/items/${row.item.id}`}
            className="font-medium text-fg hover:text-accent"
          >
            {row.item.name}
          </Link>
          <span className="text-meta text-fg-subtle">{row.item.sku}</span>
        </span>
      ),
    },
    {
      key: "issued",
      label: t("inventoryTab.issued"),
      align: "right",
      render: (row) => <span className="tabular-nums">{formatQuantity(row.issued)}</span>,
    },
    {
      key: "returned",
      label: t("inventoryTab.returned"),
      align: "right",
      hideBelow: "md",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{formatQuantity(row.returned)}</span>
      ),
    },
    {
      key: "netIssued",
      label: t("inventoryTab.consumed"),
      align: "right",
      render: (row) => (
        <span className="tabular-nums font-medium">
          {formatQuantity(row.netIssued)} {row.item.baseUnit}
        </span>
      ),
    },
  ];

  const nothingAtAll =
    consumption.length === 0 &&
    issueRows.length === 0 &&
    returnRows.length === 0 &&
    reservationRows.length === 0;

  return (
    <div className="space-y-5">
      <RecordContextHeader
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          mayIssue ? (
            <Button asChild size="sm">
              <Link href={`/inventory/issues/new?projectId=${project.id}`}>{t("inventoryTab.issueMaterial")}</Link>
            </Button>
          ) : null
        }
      />


      {nothingAtAll ? (
        <EmptyState
          icon={<Package />}
          title={t("inventoryTab.emptyTitle")}
          description={t("inventoryTab.emptyBody")}
          action={
            mayIssue
              ? {
                  label: t("inventoryTab.issueMaterial"),
                  href: `/inventory/issues/new?projectId=${project.id}`,
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {consumption.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-card font-semibold text-fg">{t("inventoryTab.consumption")}</h2>
                <p className="mt-1 text-meta text-fg-subtle">
                  Issued less returned, per item. This is what the project actually used — NESTO
                  does not put a cost on it in V0.1.
                </p>
              </div>
              <DataTable
                listId="projects.inventory.consumption"
                columns={consumptionColumns}
                records={consumption}
                rowKey={(row) => row.item.id}
                caption={t("inventoryTab.consumedOn", { name: project.name })}
              />
            </section>
          ) : null}

          {issueRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("inventoryTab.issued")}</h2>
              <IssueTable
                issues={issueRows}
                showProject={false}
                caption={t("inventoryTab.issuesTo", { name: project.name })}
              />
            </section>
          ) : null}

          {returnRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("inventoryTab.returned")}</h2>
              <ReturnTable returns={returnRows} caption={t("inventoryTab.returnsFrom", { name: project.name })} />
              <PreviewCount shown={returnRows.length} total={returnList.total} />
            </section>
          ) : null}

          {reservationRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("inventoryTab.reserved")}</h2>
              <ReservationTable
                reservations={reservationRows}
                caption={t("inventoryTab.heldFor", { name: project.name })}
              />
              <PreviewCount shown={reservationRows.length} total={reservationList.total} href={`/inventory/reservations?projectId=${project.id}`} />
            </section>
          ) : null}

          {movementRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">{t("inventoryTab.movements")}</h2>
              <MovementTable
                movements={movementRows}
                caption={t("inventoryTab.movementsOn", { name: project.name })}
              />
              <PreviewCount shown={movementRows.length} total={movementList.total} href={`/inventory/movements?projectId=${project.id}`} />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** A preview's honest count: "Latest 20 of 57", with the full list when there is one (AUD-08 §4). */
async function PreviewCount({ shown, total, href }: { shown: number; total: number; href?: string }) {
  const t = await getTranslations("projects");
  return (
    <p className="text-table text-fg-muted" data-testid="preview-count">
      {shown < total ? (
        <>
          {t("financeTab.latest")} <span className="tabular-nums">{shown}</span> {t("financeTab.of")} <span className="tabular-nums">{total}</span>
          {href ? (
            <>
              {" · "}
              <Link href={href} className="font-medium text-accent-strong hover:underline">
                {t("inventoryTab.viewAll")}
              </Link>
            </>
          ) : null}
        </>
      ) : (
        <>
          <span className="tabular-nums">{total}</span> {t("financeTab.inTotal")}
        </>
      )}
    </p>
  );
}
