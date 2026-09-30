import type { Metadata } from "next";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { PolicyForm } from "@/components/security/policy-form";
import { getTranslations } from "@/lib/i18n/server";
import { getPolicyView } from "@/lib/modules/security/security.service";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.mobile-policy.label") };
}

/**
 * Security → Mobile Policy (MOB-11 §73-§82, §79). Platform minimum, then the
 * Group, then each Company: resolved on the server, strictest value wins, so a
 * Company can tighten what its Group requires and never loosen it.
 */
export default async function MobilePolicyPage() {
  const context = await requireSettingsSection("mobile-policy");
  const [t, view] = await Promise.all([getTranslations("security"), getPolicyView(context)]);

  return (
    <div className="space-y-5">
      <SettingsPageHeader title={t("admin.policy.title")} description={t("admin.policy.description")} />

      {view.group ? (
        <section className="nesto-card p-6" aria-labelledby="policy-group-title" data-testid="policy-group">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="policy-group-title" className="text-card font-semibold text-fg">{t("admin.policy.levels.group")} · {view.group.label}</h2>
            {view.group.version ? <span className="text-meta text-fg-subtle">{t("admin.policy.version", { version: view.group.version })}</span> : null}
          </div>
          <div className="mt-4">
            <PolicyForm target={{ scope: "PARENT_GROUP", id: view.group.target.scope === "PARENT_GROUP" ? view.group.target.id : "" }} initial={view.group.settings} editable={view.group.editable} isGroup />
          </div>
        </section>
      ) : null}

      {view.companies.map((company) => (
        <section key={company.target.scope === "COMPANY" ? company.target.id : "company"} className="nesto-card p-6" data-testid="policy-company">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-card font-semibold text-fg">{t("admin.policy.levels.company")} · {company.label}</h2>
            {company.version ? <span className="text-meta text-fg-subtle">{t("admin.policy.version", { version: company.version })}</span> : null}
          </div>
          {!view.companyOverrideAllowed ? <p className="mt-2 text-meta text-fg-muted">{t("admin.policy.lockedByGroup")}</p> : null}
          <dl className="mt-3 grid gap-x-8 gap-y-1 text-meta sm:grid-cols-2" aria-label={t("admin.policy.effective", { name: company.label })} data-testid="policy-effective">
            <Effective label={t("admin.policy.fields.appLockRequired")} value={company.effective.appLockRequired ? t("admin.policy.options.yes") : t("admin.policy.options.no")} testId="effective-appLockRequired" />
            <Effective label={t("admin.policy.fields.appLockTimeoutSeconds")} value={String(company.effective.appLockTimeoutSeconds)} testId="effective-appLockTimeoutSeconds" />
            <Effective label={t("admin.policy.fields.minimumAppVersion")} value={company.effective.minimumAppVersion} testId="effective-minimumAppVersion" />
            <Effective label={t("admin.policy.fields.offlineAuthorizationHours")} value={company.effective.offlineAllowed ? String(company.effective.offlineAuthorizationHours) : t("admin.policy.options.no")} testId="effective-offlineAuthorizationHours" />
          </dl>
          <div className="mt-4">
            <PolicyForm target={{ scope: "COMPANY", id: company.target.scope === "COMPANY" ? company.target.id : "" }} initial={company.settings} editable={company.editable} isGroup={false} />
          </div>
        </section>
      ))}
    </div>
  );
}

function Effective({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg" data-testid={testId}>{value}</dd>
    </div>
  );
}
