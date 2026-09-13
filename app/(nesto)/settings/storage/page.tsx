import type { Metadata } from "next";
import { HardDrive } from "lucide-react";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getTranslations } from "@/lib/i18n/server";
import { formatFileSize } from "@/lib/modules/documents/document.files";
import {
  getCompanyStorageSummary,
  listLargestFiles,
} from "@/lib/modules/documents/storage/summary.service";
import { formatDate } from "@/lib/utils/format";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.storage.label") };
}

/**
 * Company storage usage (PRD #29 §244).
 *
 * Deliberately a read-only page. Buckets, credentials, regions and endpoints
 * are deployment configuration held in the environment, not company settings —
 * a screen that let an administrator edit them would be the wrong shape of
 * control entirely (PRD #29 §113, §246).
 */
export default async function StorageSettingsPage() {
  const context = await requireSettingsSection("storage");

  const [summary, largest, t] = await Promise.all([
    getCompanyStorageSummary(context),
    listLargestFiles(context, 10),
    getTranslations("settings"),
  ]);

  return (
    <div className="space-y-5">
      <SettingsPageHeader
        title={t("sections.storage.label")}
        description={t("storage.description")}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StorageStat label={t("storage.used")} value={formatFileSize(summary.usedBytes)} />
        <StorageStat label={t("storage.files")} value={String(summary.fileCount)} />
        <StorageStat
          label={t("storage.largestAllowed")}
          value={formatFileSize(summary.maxSingleFileBytes)}
        />
      </div>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{t("storage.allowance")}</h2>

        {summary.percentUsed === null ? (
          <p className="mt-3 text-body text-fg-muted">
            {t("storage.noLimit", { size: formatFileSize(summary.maxSingleFileBytes) })}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            <div
              role="progressbar"
              aria-valuenow={summary.percentUsed}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("storage.storageUsed")}
              className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
            >
              <div
                className={`h-full rounded-full ${summary.percentUsed >= 90 ? "bg-danger" : "bg-accent"}`}
                style={{ width: `${summary.percentUsed}%` }}
              />
            </div>
            <p className="text-table text-fg-muted">
              {t("storage.usage", {
                used: formatFileSize(summary.usedBytes),
                total: formatFileSize(summary.maxStorageBytes ?? 0),
                percent: summary.percentUsed,
              })}
            </p>
          </div>
        )}

        {summary.reservedBytes > 0 ? (
          <p className="mt-3 text-meta text-fg-subtle">
            {t("storage.reserved", { size: formatFileSize(summary.reservedBytes) })}
          </p>
        ) : null}
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{t("storage.largestFiles")}</h2>

        {largest.length === 0 ? (
          <EmptyState
            icon={<HardDrive />}
            title={t("storage.emptyTitle")}
            description={t("storage.emptyDescription")}
          />
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {largest.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-table font-medium text-fg">{file.name}</p>
                  <p className="text-meta text-fg-subtle">
                    {t("storage.added", { date: formatDate(file.createdAt) })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {file.storageStatus !== "AVAILABLE" ? (
                    <Badge tone="warning">{file.storageStatus.toLowerCase()}</Badge>
                  ) : null}
                  <span className="text-table tabular-nums text-fg-muted">
                    {formatFileSize(file.sizeBytes)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StorageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="nesto-card p-5">
      <p className="text-meta uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1.5 text-page font-semibold tabular-nums text-fg">{value}</p>
    </div>
  );
}
