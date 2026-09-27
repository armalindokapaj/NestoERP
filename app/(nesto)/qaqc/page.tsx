import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { QaqcKpiGrid } from "@/components/qaqc/qaqc-kpis";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PersonLink } from "@/components/people/person-link";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { qaqcAttention, qaqcOverview } from "@/lib/modules/qaqc/overview/overview.service";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";
import { formatDate } from "@/lib/utils/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.overview") };
}

/**
 * The QA/QC overview (PRD #21 §31–§33).
 *
 * The module's own workspace, not the personal dashboard. Every panel is gated
 * by its own permission, so a site engineer who raises defects but cannot see
 * NCRs gets a working page rather than one with holes in it.
 */
export default async function QaqcOverviewPage() {
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");
  const experience = resolveModuleExperience(context, "qaqc");

  const [overview, attention] = await Promise.all([
    qaqcOverview(context),
    qaqcAttention(context),
  ]);

  const nothingVisible =
    !overview.visible.inspections &&
    !overview.visible.defects &&
    !overview.visible.ncrs &&
    !overview.visible.requests;

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "qaqc.request.create") ? (
          <Button asChild size="sm">
            <Link href="/qaqc/requests/new">{t("common.requestInspection")}</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <QaqcKpiGrid overview={overview} />

        {nothingVisible ? (
          <EmptyState
            icon={<ShieldCheck />}
            title={t("overview.nothingVisible")}
            description={t("overview.nothingVisibleBody")}
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {overview.visible.inspections ? (
            <AttentionPanel
              title={t("overview.awaitingTitle")}
              href="/qaqc/approvals"
              emptyLabel={t("overview.awaitingEmpty")}
              rows={attention.awaitingApproval.map((row) => ({
                id: row.id,
                href: `/qaqc/inspections/${row.id}`,
                title: `${row.inspectionNumber} — ${row.project?.code ?? t("common.company")}`,
                meta: (
                  <>
                    {qaqcLabel(t, "inspectionResult", row.result)} ·{" "}
                    {row.assignedInspector ? (
                      <PersonLink memberId={row.assignedInspector.memberId} name={row.assignedInspector.fullName} />
                    ) : (
                      t("common.unassigned")
                    )}
                  </>
                ),
              }))}
            />
          ) : null}

          {overview.visible.defects ? (
            <AttentionPanel
              title={t("overview.overdueDefectsTitle")}
              href="/qaqc/defects?view=overdue"
              emptyLabel={t("overview.nothingOverdue")}
              rows={attention.overdueDefects.map((row) => ({
                id: row.id,
                href: `/qaqc/defects/${row.id}`,
                title: `${row.defectNumber} — ${row.title}`,
                meta: `${qaqcLabel(t, "severity", row.severity)}${row.dueDate ? t("overview.due", { date: formatDate(row.dueDate) }) : ""}`,
              }))}
            />
          ) : null}

          {overview.visible.ncrs ? (
            <AttentionPanel
              title={t("overview.overdueNcrsTitle")}
              href="/qaqc/ncrs?view=overdue"
              emptyLabel={t("overview.nothingOverdue")}
              rows={attention.overdueNcrs.map((row) => ({
                id: row.id,
                href: `/qaqc/ncrs/${row.id}`,
                title: `${row.ncrNumber} — ${row.title}`,
                meta: t("overview.actionsOpen", { count: row.openActions }),
              }))}
            />
          ) : null}

          {overview.visible.requests ? (
            <AttentionPanel
              title={t("overview.unassignedTitle")}
              href="/qaqc/requests?view=unassigned"
              emptyLabel={t("overview.unassignedEmpty")}
              rows={attention.unassignedRequests.map((row) => ({
                id: row.id,
                href: `/qaqc/requests/${row.id}`,
                title: `${row.requestNumber} — ${row.title}`,
                meta: row.requiredByDate
                  ? t("overview.neededBy", { date: formatDate(row.requiredByDate) })
                  : t("overview.noDate"),
              }))}
            />
          ) : null}
        </div>
      </div>
    </ModulePage>
  );
}

async function AttentionPanel({
  title,
  href,
  rows,
  emptyLabel,
}: {
  title: string;
  href: string;
  rows: { id: string; href: string; title: string; meta: React.ReactNode }[];
  emptyLabel: string;
}) {
  const t = await getTranslations("qaqc");
  return (
    <section className="nesto-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-table font-medium text-accent-strong touch:min-h-11"
        >
          {t("common.viewAll")}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0">
              {/* The whole "DEF-… — title" wraps to two lines instead of losing the title (AUD-04 §3, D-04-03/04). */}
              <Link
                href={row.href}
                className="line-clamp-2 text-table font-medium text-fg transition-colors [overflow-wrap:anywhere] hover:text-accent"
              >
                {row.title}
              </Link>
              <p className="text-meta text-fg-subtle">{row.meta}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
