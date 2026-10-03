import { getTranslations } from "@/lib/i18n/server";
import { PolicyForm } from "@/components/security/policy-form";
import { PageHeader } from "@/components/ui/page-header";
import { canPlatform, requirePlatformContext } from "@/lib/context/platform-context";
import { getPlatformMobilePolicy } from "@/lib/modules/platform/platform-mobile-security.service";

export async function generateMetadata() { const t = await getTranslations("adminPlatform"); return { title: t("system.mobilePolicy.metaTitle") }; }

/** The platform minimum every Group and Company builds on (MOB-11 §74, §79). They can be stricter than this, never less. */
export default async function PlatformMobilePolicyPage() {
  const t = await getTranslations("adminPlatform");
  const context = await requirePlatformContext();
  const policy = await getPlatformMobilePolicy(context);
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.mobilePolicy.title")} description={t("system.mobilePolicy.description")} />
      <section className="nesto-card p-6" data-testid="policy-platform">
        <p className="mb-4 text-meta text-fg-subtle">{policy.version ? t("system.mobilePolicy.version", { version: policy.version }) : t("system.mobilePolicy.notSet")}</p>
        <PolicyForm target={{ scope: "PLATFORM", id: "platform" }} initial={policy.settings} editable={canPlatform(context, "platform.mobile_policy.manage")} isGroup={false} />
      </section>
    </div>
  );
}
