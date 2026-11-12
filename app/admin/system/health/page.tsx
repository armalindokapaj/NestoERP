import { getTranslations } from "@/lib/i18n/server";
import { enumLabel } from "@/lib/i18n/modules/adminAccess/enum-label";
import { HealthGrid } from "@/components/platform/admin-health";

import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { platformHealth } from "@/lib/modules/platform/platform-control.query";
export async function generateMetadata() { const t = await getTranslations("adminPlatform"); return { title: t("system.health.metaTitle") }; }
export default async function HealthPage() { const t = await getTranslations("adminPlatform"); const detail = (text: string) => { const known = enumLabel(t, "enums.healthDetail", text, ""); if (known) return known; const provider = /^(.+) provider reachable$/.exec(text); if (provider) return t("enums.healthPattern.providerReachable", { provider: provider[1] }); const queued = /^(\d+) queued$/.exec(text); if (queued) return t("enums.healthPattern.queued", { count: queued[1] }); const failed = /^(\d+) failed deliveries$/.exec(text); if (failed) return t("enums.healthPattern.failedDeliveries", { count: failed[1] }); return text; }; const context = await requirePlatformContext(); const health = await platformHealth(context)
  return (
    <div className="space-y-5">
      <PageHeader title={t("system.health.title")} description={t("system.health.description")} />
      <section className="border border-line-strong bg-surface" aria-label={t("system.health.title")} data-testid="health-grid">
        <HealthGrid columns="page" cells={health.map((item) => ({ key: item.service, service: enumLabel(t, "enums.healthService", item.service), state: item.state, stateLabel: enumLabel(t, "enums.health", item.state), detail: detail(item.detail) }))} />
      </section>
    </div>
  )
}
