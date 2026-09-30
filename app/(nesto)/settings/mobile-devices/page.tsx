import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";

import { SettingsPageHeader } from "@/components/modules/settings-page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { securityScope, listDevices, securityDashboard, type DeviceFilters } from "@/lib/modules/security/security.service";
import { getTranslations } from "@/lib/i18n/server";
import { formatDateTime } from "@/lib/utils/format";
import { requireSettingsSection } from "../settings-access";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("sections.mobile-devices.label") };
}

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const STATUS_TONE = { ACTIVE: "success", STALE: "default", REVOKED: "danger", BLOCKED: "danger" } as const;
const COMPLIANCE_TONE = { COMPLIANT: "success", WARNING: "warning", NON_COMPLIANT: "warning", BLOCKED: "danger", UNKNOWN: "default" } as const;

const pick = <T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined => (typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined);

/**
 * Security → Mobile Devices (MOB-11 §23-§28, §140, §141). An enterprise
 * security surface, not a user list: who is signed in on what, with which
 * version, and whether it complies. Technical metadata only — nothing from any
 * business record — and in the Group workspace the union of the companies the
 * person may administer.
 */
export default async function MobileDevicesPage({ searchParams }: Params) {
  const context = await requireSettingsSection("mobile-devices");
  const params = await searchParams;
  const filters: DeviceFilters = {
    q: typeof params.q === "string" && params.q.trim() ? params.q.trim().slice(0, 80) : undefined,
    status: pick(params.status, ["ACTIVE", "STALE", "REVOKED", "BLOCKED"] as const),
    platform: pick(params.platform, ["IOS", "ANDROID"] as const),
    compliance: pick(params.compliance, ["COMPLIANT", "WARNING", "NON_COMPLIANT", "BLOCKED", "UNKNOWN"] as const),
    companyId: typeof params.company === "string" ? params.company : undefined,
  };
  const [t, scope, dashboard, { rows, total }] = await Promise.all([
    getTranslations("security"),
    securityScope(context, "security.devices.read"),
    securityDashboard(context),
    listDevices(context, filters),
  ]);

  const cards = [
    { key: "active", value: dashboard.active },
    { key: "updateRequired", value: dashboard.updateRequired },
    { key: "nonCompliant", value: dashboard.nonCompliant },
    { key: "revoked", value: dashboard.revoked },
    { key: "stale", value: dashboard.stale },
  ] as const;

  return (
    <div className="space-y-5">
      <SettingsPageHeader title={t("admin.devices.title")} description={t("admin.devices.description")} />

      <section aria-label={t("admin.devices.title")} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="device-dashboard">
        {cards.map((card) => (
          <div key={card.key} className="nesto-card p-4">
            <p className="text-meta text-fg-subtle">{t(`admin.devices.dashboard.${card.key}`)}</p>
            <p className="mt-1 text-page font-semibold text-fg" data-testid={`dashboard-${card.key}`}>{card.value}</p>
          </div>
        ))}
      </section>

      <form method="get" className="nesto-card flex flex-wrap items-end gap-3 p-4" role="search">
        <label className="grid gap-1 text-meta text-fg-subtle">
          <span>{t("admin.devices.search")}</span>
          <input name="q" defaultValue={filters.q ?? ""} className="h-10 min-w-56 rounded-md border border-control bg-surface px-3 text-body text-fg touch:h-11" />
        </label>
        <FilterSelect name="status" label={t("admin.devices.filters.status")} all={t("admin.devices.filters.all")} value={filters.status} options={["ACTIVE", "STALE", "REVOKED", "BLOCKED"].map((value) => [value, t(`devices.status.${value as "ACTIVE"}`)])} />
        <FilterSelect name="platform" label={t("admin.devices.filters.platform")} all={t("admin.devices.filters.all")} value={filters.platform} options={[["IOS", "iOS"], ["ANDROID", "Android"]]} />
        <FilterSelect name="compliance" label={t("admin.devices.filters.compliance")} all={t("admin.devices.filters.all")} value={filters.compliance} options={["COMPLIANT", "WARNING", "NON_COMPLIANT", "BLOCKED", "UNKNOWN"].map((value) => [value, t(`devices.compliance.${value as "COMPLIANT"}`)])} />
        {scope.contexts.length > 1 ? (
          <FilterSelect name="company" label={t("admin.devices.filters.company")} all={t("admin.devices.filters.all")} value={filters.companyId} options={scope.contexts.map((c) => [c.companyId, c.company.name])} />
        ) : null}
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-body font-medium text-primary-fg touch:h-11">{t("admin.devices.filters.apply")}</button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={t("admin.devices.empty")} />
      ) : (
        <section className="nesto-card p-5">
          <Table flush aria-label={t("admin.devices.title")}>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("admin.devices.columns.user")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.devices.columns.device")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.devices.columns.status")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.devices.columns.compliance")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.devices.columns.version")}</TableHeaderCell>
                <TableHeaderCell>{t("admin.devices.columns.lastSeen")}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid="device-admin-row">
                  <TableCell>
                    <Link href={`/settings/mobile-devices/${row.id}`} className="font-medium text-fg hover:underline">{row.user.fullName}</Link>
                    <p className="text-meta text-fg-subtle">{row.companies.join(", ")}</p>
                  </TableCell>
                  <TableCell>{row.name} <span className="text-meta text-fg-subtle">· {row.platform === "IOS" ? "iOS" : "Android"}</span></TableCell>
                  <TableCell><Badge tone={STATUS_TONE[row.status]}>{t(`devices.status.${row.status}`)}</Badge></TableCell>
                  <TableCell><Badge tone={COMPLIANCE_TONE[row.complianceState as keyof typeof COMPLIANCE_TONE] ?? "default"}>{t(`devices.compliance.${row.complianceState as "COMPLIANT"}`)}</Badge></TableCell>
                  <TableCell>{row.appVersion}</TableCell>
                  <TableCell>{formatDateTime(row.lastSeenAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-meta text-fg-subtle">{rows.length} / {total}</p>
        </section>
      )}
    </div>
  );
}

function FilterSelect({ name, label, all, value, options }: { name: string; label: string; all: string; value?: string; options: string[][] }) {
  return (
    <label className="grid gap-1 text-meta text-fg-subtle">
      <span>{label}</span>
      <select name={name} defaultValue={value ?? ""} className="h-10 rounded-md border border-control bg-surface px-3 text-body text-fg touch:h-11">
        <option value="">{all}</option>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}
