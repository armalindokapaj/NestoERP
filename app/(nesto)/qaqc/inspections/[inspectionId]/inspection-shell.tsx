import { RecordFavorite } from "@/components/productivity/record-favorite";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { InspectionActions } from "@/components/qaqc/inspection-actions";
import { ResultBadge } from "@/components/qaqc/qaqc-format";
import { RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import type { UserContext } from "@/lib/context/types";
import { pendingCycle } from "@/lib/modules/qaqc/approvals/approval.service";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import { inspectionTypeLabels } from "@/lib/modules/qaqc/qaqc.status";
import type { InspectionDetailDTO } from "@/lib/modules/qaqc/qaqc.types";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * The furniture every inspection tab shares (PRD #21 §10, §63, §65).
 *
 * The header carries **both** status and result, side by side. An inspection at
 * "pending approval" with a result of "fail" is an ordinary and important
 * state, and a page that shows one field where the reader expects two is how
 * those get confused.
 */
const TABS = [
  { key: "overview", label: "Overview", suffix: "" },
  { key: "execute", label: "Checklist", suffix: "/execute" },
  { key: "documents", label: "Documents", suffix: "/documents" },
  { key: "activity", label: "Activity", suffix: "/activity" },
] as const;

export type InspectionTabKey = (typeof TABS)[number]["key"];

/** Cached per request: the shell's pre-stream guard asks first, and the page reuses the answer (NAV-01 §2.1). */
export const loadInspectionPage = cache(async function loadInspectionPage(
  inspectionId: string,
  tab: InspectionTabKey,
): Promise<{ context: UserContext; inspection: InspectionDetailDTO }> {
  const context = await requireModule("qaqc");

  let inspection: InspectionDetailDTO;
  try {
    inspection = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const allowed: Record<InspectionTabKey, boolean> = {
    overview: true,
    execute: inspection.checklist.length > 0 || inspection.capabilities.canExecute,
    documents: inspection.capabilities.canViewDocuments,
    activity: inspection.capabilities.canViewActivity,
  };
  if (!allowed[tab]) notFound();

  return { context, inspection };
});

export async function InspectionPageShell({
  context,
  inspection,
  tab,
  children,
}: {
  context: UserContext;
  inspection: InspectionDetailDTO;
  tab: InspectionTabKey;
  children: React.ReactNode;
}) {
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle =
    inspection.capabilities.canApprove || inspection.capabilities.canReject
      ? await pendingCycle(context, "INSPECTION", inspection.id)
      : null;
  const show: Record<InspectionTabKey, boolean> = {
    overview: true,
    execute: inspection.checklist.length > 0 || inspection.capabilities.canExecute,
    documents: inspection.capabilities.canViewDocuments,
    activity: inspection.capabilities.canViewActivity,
  };

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Inspections", href: "/qaqc/inspections" },
          { label: inspection.inspectionNumber },
        ]}
        title={inspection.summary ?? inspection.inspectionNumber}
        subtitle={inspection.inspectionNumber}
        status={inspection.status}
        badges={
          <>
            <ResultBadge result={inspection.result} />
            <Badge tone="neutral">{inspectionTypeLabels[inspection.inspectionType]}</Badge>
            {inspection.reinspectionSequence ? (
              <Badge tone="info">Reinspection {inspection.reinspectionSequence}</Badge>
            ) : null}
          </>
        }
        meta={[
          {
            label: "Inspector",
            value: inspection.assignedInspector ? (
              <PersonLink memberId={inspection.assignedInspector.memberId} name={inspection.assignedInspector.fullName} />
            ) : (
              "Not assigned"
            ),
          },
          {
            label: "Inspected",
            value: inspection.inspectionDate ? formatDate(inspection.inspectionDate) : "Not yet",
          },
          {
            label: "Project",
            value: inspection.project ? inspection.project.code : "Company",
          },
        ]}
        actions={
          <>
            <RecordFavorite context={context} entityType="quality_inspection" entityId={inspection.id} />
            <InspectionActions inspection={inspection} cycle={cycle} />
          </>
        }
      />

      <nav aria-label="Inspection sections" className="border-b border-line">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.filter((entry) => show[entry.key]).map((entry) => {
            const isActive = entry.key === tab;
            return (
              <li key={entry.key}>
                <Link
                  href={`/qaqc/inspections/${inspection.id}${entry.suffix}`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    // 44px under touch (AUD-04 §3, D-04-07, MW-19).
                    "inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-table font-medium transition-colors touch:h-11",
                    isActive
                      ? "border-accent text-fg"
                      : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  {entry.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {inspection.status === "REJECTED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This inspection was rejected and sent back. Reworking it returns it to being under way
          — the rejection stays on the record.
        </p>
      ) : inspection.status === "CANCELLED" ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          This inspection was cancelled. It has no quality effect and releases nothing.
        </p>
      ) : inspection.result === "CONDITIONAL" && inspection.decisionNote ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          <span className="font-medium text-fg">Accepted on condition:</span>{" "}
          {inspection.decisionNote}
        </p>
      ) : null}

      {children}
    </div>
  );
}
