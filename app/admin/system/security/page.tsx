import { getTranslations } from "@/lib/i18n/server";
import type { Metadata } from "next";

import Link from "@/components/navigation/nav-link";
import { AdminStatusBadge } from "@/components/platform/admin-status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { systemOverview } from "@/lib/modules/platform/platform-system.service";
import { Fact } from "../_parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPlatform");
  return { title: t("system.security.metaTitle") };
}

/** A factual security summary (Admin System PRD #6 §58): no score, only what NESTO knows. */
export default async function SecurityPage() {
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const { security, authentication, email } = await systemOverview(context);
  const unrecoverable = security.platformAdmins.filter((row) => !row.canRecover);
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.security.title")} description={t("system.security.description")} />
      <section className="nesto-card p-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t("system.security.sessionPolicy")}>{t("system.security.hours", { hours: authentication.sessionHours })}</Fact>
          <Fact label={t("system.security.passwordResetEmail")}>{email.status === "Configured" ? t("system.security.available") : t("system.security.unavailable")}</Fact>
          <Fact label={t("system.security.failedSignins")}><Link href="/admin/audit/failed-logins" className="text-accent-strong hover:underline">{security.failedLogins24h}</Link></Fact>
          <Fact label={t("system.security.platformAdmins")}>{security.platformAdmins.length}</Fact>
        </dl>
        {security.platformAdmins.length === 1 ? <p className="mt-4 text-table text-warning-strong">{t("system.security.onlyOne")}</p> : null}
        {unrecoverable.length ? <p className="mt-2 text-table text-warning-strong">{t("system.security.unrecoverable", { count: unrecoverable.length, names: unrecoverable.map((row) => row.name).join(", ") })}</p> : null}
      </section>
      <section className="nesto-card divide-y divide-line" aria-label={t("system.security.accountsLabel")}>
        {security.platformAdmins.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <Link href={`/admin/users/${row.id}`} className="font-medium text-fg hover:underline">{row.name}<span className="ml-2 font-mono text-meta text-fg-subtle">{row.username}</span></Link>
            <span className="flex items-center gap-2"><span className="text-meta text-fg-subtle">{row.canRecover ? t("system.security.recoveryVerified") : t("system.security.noRecovery")}</span><AdminStatusBadge status={row.active ? "ACTIVE" : "SUSPENDED"} /></span>
          </div>
        ))}
      </section>
    </div>
  );
}
