import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { getTranslations } from "@/lib/i18n/server";
import { canGroup, requireGroupContext } from "@/lib/context/group-context";
import { groupOverview } from "@/lib/modules/group/group-workspace.query";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("group");
  return { title: t("shell.overview") };
}

/** Where a group-only person lands (Admin PRD #9 §24, §25, §90): the group, its CEO and what to do next. */
export default async function GroupOverviewPage() {
  const t = await getTranslations("group");
  const to = await getTranslations("adminOrgs");
  const context = await requireGroupContext();
  const overview = await groupOverview(context);
  const steps = [
    { key: "ceo", done: overview.ceo !== null },
    { key: "company", done: overview.companies > 0 },
    { key: "users", done: overview.seats > 1 },
  ] as const;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-page font-semibold text-fg">{t("overview.welcome", { name: context.groupName })}</h1>
        <p className="mt-1 text-body text-fg-muted">{to(`groupUsers.role${context.roleKey}`)}</p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="nesto-card p-5"><dt className="text-meta text-fg-subtle">{t("overview.ceo")}</dt><dd className="mt-1 text-body font-medium text-fg" data-testid="group-ceo">{overview.ceo ?? t("overview.notAssigned")}</dd></div>
        <div className="nesto-card p-5"><dt className="text-meta text-fg-subtle">{t("overview.companies")}</dt><dd className="mt-1 text-page font-semibold tabular-nums text-fg" data-testid="group-company-count">{overview.companies}</dd></div>
        <div className="nesto-card p-5"><dt className="text-meta text-fg-subtle">{t("overview.users")}</dt><dd className="mt-1 text-page font-semibold tabular-nums text-fg">{overview.seats}</dd></div>
      </dl>
      <section className="nesto-card p-5" aria-label={t("overview.setup")}>
        <h2 className="text-card font-semibold text-fg">{t("overview.setup")}</h2>
        <ul className="mt-3 space-y-2">
          {steps.map((step) => (
            <li key={step.key} className="flex items-center gap-2 text-body text-fg">
              <span aria-hidden="true" className={step.done ? "text-success" : "text-fg-subtle"}>{step.done ? "✓" : "○"}</span>
              <span>{t(`overview.checklist.${step.key}`)}</span>
              <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
            </li>
          ))}
        </ul>
        {overview.companies === 0 && canGroup(context, "group.companies.view") ? (
          <div className="mt-4 space-y-2">
            <p className="text-table text-fg-muted">{t("overview.nextCompany")}</p>
            <Link href="/group/companies" className="inline-flex h-9 items-center rounded-lg bg-accent px-3 text-table font-medium text-accent-fg hover:opacity-90">{t("overview.goCompanies")}</Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
