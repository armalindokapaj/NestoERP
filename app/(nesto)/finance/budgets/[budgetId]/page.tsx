import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { CollaborationPanel } from "@/components/collaboration/collaboration-panel";
import { ApprovalHistory } from "@/components/finance/approval-history";
import { BudgetActions } from "@/components/finance/budget-actions";
import { BudgetRiskBadge } from "@/components/finance/budget-risk-badge";
import { Money, Variance } from "@/components/finance/money";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { PersonLink } from "@/components/people/person-link";
import { Badge } from "@/components/ui/badge";
import { ScrollRegion } from "@/components/ui/scroll-region";
import { getTranslations } from "@/lib/i18n/server";
import { pendingCycle } from "@/lib/modules/finance/approvals/approval.service";
import { formatDate } from "@/lib/utils/format";
import { budgetBreadcrumbs, budgetLabel, loadBudget } from "./budget-context";
import { FinanceRecordTabs } from "../../invoices/[invoiceId]/record-tabs";

type Params = { params: Promise<{ budgetId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { budgetId } = await params;
  try {
    const { budget } = await loadBudget(budgetId);
    return { title: budgetLabel(budget, await getTranslations("finance")) };
  } catch {
    return { title: (await getTranslations("finance"))("kind.budget") };
  }
}

/**
 * Budget detail (PRD #15 §179).
 *
 * Actual, committed and forecast are the *project's* figures, not this
 * version's — so a superseded budget shows what the project has really spent,
 * which is the only comparison that means anything (PRD #15 §118).
 */
export default async function BudgetDetailPage({ params }: Params) {
  const { budgetId } = await params;
  const { context, budget } = await loadBudget(budgetId);

  const may = budget.capabilities;
  const t = await getTranslations("finance");
  // The cycle the decision controls act on; they name it back (AUD-10 §4, CW-05).
  const cycle = may.canApprove || may.canReject ? await pendingCycle(context, "BUDGET", budget.id) : null;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={await budgetBreadcrumbs(budget)}
        title={budget.name ?? budgetLabel(budget, t)}
        subtitle={t("budgets.subtitle", { project: budget.project.name, version: budget.version })}
        status={budget.status}
        badges={budget.isCurrent ? <Badge tone="info">{t("current")}</Badge> : null}
        meta={[
          {
            label: t("columns.budget"),
            value: <Money amount={budget.budgetAmount} currency={budget.currency} emphasis />,
          },
          {
            label: t("columns.forecast"),
            value: <Money amount={budget.forecastCost} currency={budget.currency} />,
          },
          {
            label: t("columns.variance"),
            value: <Variance amount={budget.variance} currency={budget.currency} />,
          },
        ]}
        actions={
          <BudgetActions budgetId={budget.id} label={budgetLabel(budget, t)} capabilities={may} cycle={cycle} />
        }
      />

      <FinanceRecordTabs
        basePath={`/finance/budgets/${budget.id}`}
        active="overview"
        show={{ documents: may.canViewDocuments, activity: may.canViewActivity }}
      />

      {budget.status === "APPROVED" && !budget.isCurrent ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("budgets.supersededNote")}
        </p>
      ) : null}

      {budget.status === "APPROVED" && budget.isCurrent ? (
        <p className="rounded-md border border-line bg-surface-2 px-4 py-3 text-table text-fg-muted">
          {t("budgets.currentNote")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="nesto-card p-5 lg:col-span-2">
          <h2 className="text-card font-semibold text-fg">{t("lines.budgetLines")}</h2>

          <ScrollRegion label={t("lines.budgetLines")} className="mt-4">
            <table className="w-full text-table">
              <caption className="sr-only">{t("lines.budgetLines")}</caption>
              <thead className="border-b border-line text-meta uppercase tracking-wide text-fg-subtle">
                <tr>
                  <th scope="col" className="py-2 text-left font-medium">
                    {t("form.category")}
                  </th>
                  <th scope="col" className="py-2 text-left font-medium">
                    {t("form.description")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("budgets.planned")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {budget.lineItems.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2.5 pr-3">
                      <Badge tone="neutral">{t(`category.${line.category}`)}</Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-fg">{line.description}</td>
                    <td className="py-2.5 text-right">
                      <Money amount={line.plannedAmount} currency={budget.currency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-table">
            <Row label={t("columns.budget")}>
              <Money amount={budget.budgetAmount} currency={budget.currency} emphasis />
            </Row>
            <Row label={t("budgets.actualCost")}>
              <Money amount={budget.actualCost} currency={budget.currency} />
            </Row>
            <Row label={t("overview.openCommitments")}>
              <Money amount={budget.openCommitments} currency={budget.currency} />
            </Row>
            <Row label={t("columns.forecast")}>
              <Money amount={budget.forecastCost} currency={budget.currency} emphasis />
            </Row>
            <Row label={t("columns.variance")}>
              <Variance amount={budget.variance} currency={budget.currency} />
            </Row>
          </dl>

          {budget.notes ? (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="text-table font-medium text-fg">{t("form.notes")}</h3>
              <p className="mt-1 whitespace-pre-wrap text-table text-fg-muted">{budget.notes}</p>
            </div>
          ) : null}
        </section>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.details")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: t("form.project"),
                  value: (
                    <Link
                      href={`/projects/${budget.project.id}/finance`}
                      className="hover:text-accent"
                    >
                      {budget.project.name}
                    </Link>
                  ),
                },
                { label: t("budgets.version"), value: `v${budget.version}` },
                { label: t("form.currency"), value: budget.currency },
                {
                  label: t("budgets.utilisation"),
                  value: (
                    <BudgetRiskBadge
                      risk={budget.risk}
                      utilizationPercent={budget.utilizationPercent}
                    />
                  ),
                },
                {
                  label: t("recordStatus.APPROVED"),
                  value: budget.approvedAt ? formatDate(budget.approvedAt) : "—",
                },
                { label: t("budgets.draftedBy"), value: budget.createdBy ? <PersonLink memberId={budget.createdBy.memberId} name={budget.createdBy.fullName} /> : "—" },
              ]}
            />
          </section>

          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.approvals")}</h2>
            <ApprovalHistory approvals={budget.approvals} />
          </section>
        </div>
      </div>
      {/* Discussion on this record: comments, mentions, watchers (PRD #38 §36). */}
      <CollaborationPanel parentType="budget" parentId={budgetId} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-fg-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
