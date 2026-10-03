import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { systemOverview } from "@/lib/modules/platform/platform-system.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPlatform");
  return { title: t("system.integrations.metaTitle") };
}

const TONE: Record<string, string> = { Connected: "text-success-strong", Error: "text-danger-strong", "Configuration Required": "text-warning-strong", "Not Connected": "text-fg-muted" };

/** Platform-level services and whether NESTO could verify them (Admin System PRD #6 §54, §55). */
export default async function IntegrationsPage() {
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const detail = (text: string) => {
    if (text === "Set MAIL_PROVIDER, MAIL_FROM and MAIL_API_KEY in the deployment.") return t("enums.integrationDetail.emailConfig");
    if (text === "Not available in this version.") return t("enums.integrationDetail.notAvailable");
    const verified = /^(.+), verified by the last test send$/.exec(text);
    if (verified) return t("enums.integrationPattern.verifiedByTest", { provider: verified[1] });
    const driver = /^(.+) driver, health check (passed|failed)$/.exec(text);
    if (driver) return t("enums.integrationPattern.driverHealth", { driver: driver[1], result: t(driver[2] === "passed" ? "enums.integrationPattern.passed" : "enums.integrationPattern.failed") });
    return text;
  };
  const { integrations } = await systemOverview(context);
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.integrations.title")} description={t("system.integrations.description")} />
      <section className="nesto-card divide-y divide-line">
        {integrations.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div><p className="text-body font-medium text-fg">{enumLabel(t, "enums.integrationName", row.key, row.name)}</p><p className="text-table text-fg-muted">{detail(row.detail)}</p></div>
            <span className={`text-table font-medium ${TONE[row.status] ?? "text-fg"}`}>{enumLabel(t, "enums.integrationStatus", row.status)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
