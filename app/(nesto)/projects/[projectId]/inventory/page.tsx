import type { Metadata } from "next";
import Link from "next/link";
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
import { loadProject, projectBreadcrumbs } from "../project-context";
import { ProjectTabs } from "../project-tabs";

type Params = { params: Promise<{ projectId: string }> };

export const metadata: Metadata = { title: "Project inventory" };

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
  const actions = projects.projectActions(context);

  if (!actions.canViewInventory) redirect("/access-denied");

  const [consumption, issueRows, returnRows, reservationRows, movementRows] = await Promise.all([
    projectConsumption(context, projectId),
    issues.listForProject(context, projectId),
    can(context, "inventory.return.view")
      ? returns
          .listReturns(context, transactionListQuerySchema.parse({ projectId, limit: 20 }))
          .then((result) => result.data)
      : Promise.resolve([]),
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
          .then((result) => result.data)
      : Promise.resolve([]),
    can(context, "inventory.movement.view")
      ? movements
          .listMovements(context, movementListQuerySchema.parse({ projectId, limit: 20 }))
          .then((result) => result.data)
      : Promise.resolve([]),
  ]);

  const mayIssue = can(context, "inventory.issue.create");
  const consumptionColumns: TableColumn<ProjectConsumptionRow>[] = [
    {
      key: "item",
      label: "Item",
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
      label: "Issued",
      align: "right",
      render: (row) => <span className="tabular-nums">{formatQuantity(row.issued)}</span>,
    },
    {
      key: "returned",
      label: "Returned",
      align: "right",
      hideBelow: "md",
      render: (row) => (
        <span className="tabular-nums text-fg-muted">{formatQuantity(row.returned)}</span>
      ),
    },
    {
      key: "netIssued",
      label: "Consumed",
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
        breadcrumbs={projectBreadcrumbs(project, "Inventory")}
        title={project.name}
        subtitle={project.code}
        status={project.status}
        actions={
          mayIssue ? (
            <Button asChild size="sm">
              <Link href={`/inventory/issues/new?projectId=${project.id}`}>Issue material</Link>
            </Button>
          ) : null
        }
      />

      <ProjectTabs
        projectId={project.id}
        active="inventory"
        show={{
          tasks: actions.canViewTasks,
          team: actions.canViewMembers,
          finance: actions.canViewFinance,
          contracts: actions.canViewContracts,
          inventory: true,
          qaqc: actions.canViewQaqc,
          hse: actions.canViewHse,
          documents: actions.canViewDocuments,
          activity: actions.canViewActivity,
        }}
      />

      {nothingAtAll ? (
        <EmptyState
          icon={<Package />}
          title="No material on this project."
          description="Issues, returns and reservations against this project appear here as they are posted."
          action={
            mayIssue
              ? {
                  label: "Issue material",
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
                <h2 className="text-card font-semibold text-fg">Consumption</h2>
                <p className="mt-1 text-meta text-fg-subtle">
                  Issued less returned, per item. This is what the project actually used — NESTO
                  does not put a cost on it in V0.1.
                </p>
              </div>
              <DataTable
                columns={consumptionColumns}
                records={consumption}
                rowKey={(row) => row.item.id}
                caption={`Material consumed on ${project.name}`}
              />
            </section>
          ) : null}

          {issueRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Issued</h2>
              <IssueTable
                issues={issueRows}
                showProject={false}
                caption={`Issues to ${project.name}`}
              />
            </section>
          ) : null}

          {returnRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Returned</h2>
              <ReturnTable returns={returnRows} caption={`Returns from ${project.name}`} />
            </section>
          ) : null}

          {reservationRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Reserved</h2>
              <ReservationTable
                reservations={reservationRows}
                caption={`Stock held for ${project.name}`}
              />
            </section>
          ) : null}

          {movementRows.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-card font-semibold text-fg">Recent movements</h2>
              <MovementTable
                movements={movementRows}
                caption={`Stock movements on ${project.name}`}
              />
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
