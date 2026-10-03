import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { systemOverview } from "@/lib/modules/platform/platform-system.service";
import { Fact, Status } from "../_parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPlatform");
  return { title: t("system.authentication.metaTitle") };
}

/** How people sign in (Admin System PRD #6 §31-§33, §48, §49): one eight-hour session policy everywhere, read-only. */
export default async function AuthenticationPage() {
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const { authentication } = await systemOverview(context);
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.authentication.title")} description={t("system.authentication.description")} />
      <section className="nesto-card p-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t("system.authentication.sessionDuration")}>{t("system.authentication.hours", { hours: authentication.sessionHours })}</Fact>
          <Fact label={t("system.authentication.appliesTo")}>{t("system.authentication.appliesToValue")}</Fact>
          <Fact label={t("system.authentication.method")}>{enumLabel(t, "system.authentication.methods", authentication.method)}</Fact>
          <Fact label={t("system.authentication.passwordReset")}><Status value={authentication.passwordReset === "Enabled" ? "Enabled" : "Disabled"} /> <span className="text-meta text-fg-subtle">{authentication.passwordReset === "Enabled" ? t("system.authentication.byEmailLink") : enumLabel(t, "system.authentication.resetStates", authentication.passwordReset)}</span></Fact>
        </dl>
        <p className="mt-4 text-table text-fg-muted">{t("system.authentication.note", { hours: authentication.sessionHours, requests: authentication.resetRequests7d })}</p>
      </section>
    </div>
  );
}
