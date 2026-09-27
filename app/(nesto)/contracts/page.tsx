import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { ArrowRight, Scale } from "lucide-react";

import { ContractKpiGrid } from "@/components/contracts/contract-kpis";
import { ModulePage } from "@/components/modules/module-page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { can } from "@/lib/access/can";
import { resolveModuleExperience } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import {
  contractAttention,
  contractOverview,
} from "@/lib/modules/contracts/overview/overview.service";
import { commercialLabel, expiryLabel } from "@/components/contracts/contract-format";
import { formatDate } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("contracts");
  return { title: t("meta.legal") };
}

/**
 * The Legal overview (PRD #18 §32–§34, §339).
 *
 * The module's own dashboard, not the personal one at /dashboard. Every panel
 * is gated by its own permission, so a reader granted contract visibility
 * without commercial values sees a legal workspace rather than a page with
 * holes in it (PRD #18 §495).
 */
export default async function ContractsOverviewPage() {
  const context = await requireModule("contracts");
  const experience = resolveModuleExperience(context, "contracts");
  const t = await getTranslations("contracts");

  const [overview, attention] = await Promise.all([
    contractOverview(context),
    can(context, "legal.contract.view")
      ? contractAttention(context)
      : Promise.resolve(null),
  ]);

  return (
    <ModulePage
      experience={experience}
      activeSection="overview"
      actions={
        can(context, "legal.contract.create") ? (
          <Button asChild size="sm">
            <Link href="/contracts/new">{t("common.newContract")}</Link>
          </Button>
        ) : null
      }
    >
      <div className="space-y-5">
        <ContractKpiGrid overview={overview} />

        {!overview.visible.contracts ? (
          <EmptyState
            icon={<Scale />}
            title={t("overview.emptyTitle")}
            description={t("overview.emptyDescription")}
          />
        ) : null}

        {attention ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <AttentionPanel
              title={t("overview.expiringSoon")}
              href="/contracts/expiring"
              emptyLabel={t("overview.expiringEmpty")}
              rows={attention.expiring.map((row) => ({
                id: row.id,
                href: `/contracts/${row.id}`,
                primary: row.contractNumber,
                secondary: row.title,
                meta: expiryLabel(row.attention.daysToExpiry, t),
              }))}
            />

            <AttentionPanel
              title={t("overview.renewalNoticeDue")}
              href="/contracts/expiring"
              emptyLabel={t("overview.renewalEmpty")}
              rows={attention.renewalNoticeDue.map((row) => ({
                id: row.id,
                href: `/contracts/${row.id}`,
                primary: row.contractNumber,
                secondary: row.client?.name ?? row.counterpartyName ?? t("common.noCounterparty"),
                meta: row.expiryDate ? formatDate(row.expiryDate) : "—",
              }))}
            />

            <AttentionPanel
              title={t("overview.readyToActivate")}
              href="/contracts/all?status=SIGNED"
              emptyLabel={t("overview.readyEmpty")}
              rows={attention.readyToActivate.map((row) => ({
                id: row.id,
                href: `/contracts/${row.id}`,
                primary: row.contractNumber,
                secondary: row.title,
                meta: row.effectiveDate ? formatDate(row.effectiveDate) : "—",
              }))}
            />

            <AttentionPanel
              title={t("overview.awaitingSignature")}
              href="/contracts/all?status=SENT"
              emptyLabel={t("overview.awaitingEmpty")}
              rows={attention.awaitingSignature.map((row) => ({
                id: row.id,
                href: `/contracts/${row.id}`,
                primary: row.contractNumber,
                secondary: row.client?.name ?? row.counterpartyName ?? t("common.noCounterparty"),
                meta: commercialLabel(row.commercial, t) ?? "—",
              }))}
            />

            {overview.visible.obligations ? (
              <AttentionPanel
                title={t("overview.overdueObligations")}
                href="/contracts/reports"
                emptyLabel={t("overview.overdueEmpty")}
                rows={attention.overdueObligations.map((row) => ({
                  id: row.id,
                  href: `/contracts/${row.contractId}/obligations`,
                  primary: row.title,
                  secondary: row.responsible?.fullName ?? t("common.unassigned"),
                  meta: t("overview.daysOverdue", { count: row.daysOverdue }),
                }))}
              />
            ) : null}

            {attention.inactiveOwners.length > 0 ? (
              <AttentionPanel
                title={t("overview.ownerLeft")}
                href="/contracts/active"
                emptyLabel={t("overview.ownerLeftEmpty")}
                rows={attention.inactiveOwners.map((row) => ({
                  id: row.id,
                  href: `/contracts/${row.id}`,
                  primary: row.contractNumber,
                  secondary: t("overview.noLongerActive", { name: row.owner.fullName }),
                  meta: t("overview.reassign"),
                }))}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </ModulePage>
  );
}

type AttentionRow = {
  id: string;
  href: string;
  primary: string;
  secondary: string;
  meta: string;
};

async function AttentionPanel({
  title,
  href,
  rows,
  emptyLabel,
}: {
  title: string;
  href: string;
  rows: AttentionRow[];
  emptyLabel: string;
}) {
  const t = await getTranslations("contracts");
  return (
    <section className="nesto-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-card font-semibold text-fg">{title}</h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-table font-medium text-accent-strong"
        >
          {t("common.all")}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-table text-fg-subtle">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
              <Link href={row.href} className="min-w-0">
                <span className="block truncate text-table text-fg transition-colors hover:text-accent">
                  {row.primary}
                </span>
                <span className="block truncate text-meta text-fg-subtle">{row.secondary}</span>
              </Link>
              <span className="shrink-0 text-meta tabular-nums text-fg-subtle">{row.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
