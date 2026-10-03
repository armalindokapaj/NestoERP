import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import type { Metadata } from "next";

import { PlatformCommandButton } from "@/components/platform/platform-command";
import { PageHeader } from "@/components/ui/page-header";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { systemOverview } from "@/lib/modules/platform/platform-system.service";
import { formatDateTime } from "@/lib/utils/format";
import { Fact } from "../_parts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPlatform");
  return { title: t("system.email.metaTitle") };
}

/**
 * Email delivery (Admin System PRD #6 §50-§52): provider, status, sender and
 * the last test. The API key is shown as Configured, never its value; it is
 * changed in the deployment, not here.
 */
export default async function EmailPage() {
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const { email } = await systemOverview(context);
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.email.title")} description={t("system.email.description")} actions={canPlatform(context, "platform.settings.manage") ? <PlatformCommandButton label={t("system.email.sendTest")} title={t("system.email.sendTestTitle")} description={t("system.email.sendTestDescription")} action="system.testEmail" fields={[{ name: "to", label: t("system.email.sendTo"), type: "email", required: true }]} submitLabel={t("system.email.send")} success={t("system.email.testSuccess")} variant="primary" /> : undefined} />
      <section className="nesto-card p-5">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t("system.email.provider")}>{email.provider}</Fact>
          <Fact label={t("system.email.status")}><span className={email.status === "Configured" ? "font-medium text-success-strong" : "font-medium text-warning-strong"}>{enumLabel(t, "enums.emailStatus", email.status)}</span></Fact>
          <Fact label={t("system.email.sender")}>{email.sender ?? t("common.notSet")}</Fact>
          <Fact label={t("system.email.apiKey")}>{email.apiKey === "Configured" ? t("common.configured") : email.apiKey === "Not set" ? t("common.notSet") : email.apiKey}</Fact>
          <Fact label={t("system.email.lastTest")}>{email.lastTest ? `${enumLabel(t, "enums.mailStatus", email.lastTest.status, email.lastTest.status.toLowerCase())} · ${formatDateTime(email.lastTest.at)}${email.lastTest.errorCode ? ` · ${email.lastTest.errorCode}` : ""}` : t("common.never")}</Fact>
          <Fact label={t("system.email.failed")}>{email.failed7d}</Fact>
        </dl>
        {email.status !== "Configured" ? <p className="mt-4 text-table text-warning-strong">{t("system.email.notDelivering")}</p> : null}
      </section>
    </div>
  );
}
