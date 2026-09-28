import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { systemOverview } from "@/lib/modules/platform/platform-system.service";

export const metadata: Metadata = { title: "Integrations" };

const TONE: Record<string, string> = { Connected: "text-success-strong", Error: "text-danger-strong", "Configuration Required": "text-warning-strong", "Not Connected": "text-fg-muted" };

/** Platform-level services and whether NESTO could verify them (Admin System PRD #6 §54, §55). */
export default async function IntegrationsPage() {
  const context = await requirePlatformContext();
  const { integrations } = await systemOverview(context);
  return (
    <div className="space-y-5">
      <PageHeader title="Integrations" description="Connected means NESTO verified it, not merely that a key is present." />
      <section className="nesto-card divide-y divide-line">
        {integrations.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div><p className="text-body font-medium text-fg">{row.name}</p><p className="text-table text-fg-muted">{row.detail}</p></div>
            <span className={`text-table font-medium ${TONE[row.status] ?? "text-fg"}`}>{row.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
