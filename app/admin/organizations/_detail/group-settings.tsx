import type { getGroupImplementation } from "@/lib/modules/platform/platform-implementation.service";
import { LogoUpload } from "@/components/platform/logo-upload";
import { getTranslations } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils/format";

type Props = { implementation: Awaited<ReturnType<typeof getGroupImplementation>> };

/**
 * A group's Settings tab (Organizations PRD §44): its identity, branding and
 * lifecycle. Editing is in the page header (Edit details, Branding,
 * Lifecycle); company settings stay on each company.
 */
export async function GroupSettings({ implementation }: Props) {
  const t = await getTranslations("adminOrgs");
  const { group } = implementation;
  const rows: [string, string | null][] = [
    [t("group.settings.groupName"), group.name], [t("group.settings.code"), group.slug], [t("group.settings.legalName"), group.legalName], [t("group.settings.country"), group.country], [t("group.settings.timeZone"), group.timezone], [t("group.settings.currency"), group.currency],
    [t("group.settings.activeSince"), group.activatedAt ? formatDate(group.activatedAt) : null],
  ];
  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="group-general">
        <h2 id="group-general" className="text-card font-semibold text-fg">{t("group.settings.general")}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{value || "—"}</dd></div>)}
        </dl>
      </section>
      <section className="nesto-card p-5" aria-labelledby="group-branding">
        <h2 id="group-branding" className="text-card font-semibold text-fg">{t("group.settings.branding")}</h2>
        <p className="mt-2 text-table text-fg-muted">{group.logoUrl ? t("group.settings.logoSet") : t("group.settings.logoNone")}</p>
        {group.status !== "ARCHIVED" ? <LogoUpload kind="group" id={group.id} name={group.name} logoUrl={group.logoUrl} /> : null}
      </section>
    </div>
  );
}
