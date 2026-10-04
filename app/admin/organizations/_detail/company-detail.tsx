import Link from "@/components/navigation/nav-link";
import { LogoUpload } from "@/components/platform/logo-upload";
import { CheckCircle2, Circle } from "lucide-react";

import { requirePlatformContext } from "@/lib/context/platform-context";
import { CompanyLeadershipCard } from "@/components/platform/company-leadership";
import { getCompanyLeadership } from "@/lib/modules/platform/company-leadership.service";
import { platformActor } from "@/lib/modules/platform/group-actor";
import { PlatformCommandButton, PlatformCommandMenu } from "@/components/platform/platform-command";
import { RECOVERY_RETENTION_DAYS } from "@/lib/modules/platform/recovery-constants";
import { deleteItem, purgeItem, restoreItem } from "./recovery-actions";
import { getTranslations } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/translator";
import { formatDate } from "@/lib/utils/format";
import type { getPlatformCompanyOverview } from "@/lib/modules/platform/platform-company.service";

type Overview = Awaited<ReturnType<typeof getPlatformCompanyOverview>>;
type Props = { overview: Overview };

export function companyFields(t: Translate<"adminOrgs">) {
  return [
    { name: "name", label: t("company.fields.name"), type: "text", required: true },
    { name: "legalName", label: t("company.fields.legalName"), type: "text" },
    { name: "registrationNumber", label: t("company.fields.registrationNumber"), type: "text" },
    { name: "taxNumber", label: t("company.fields.taxNumber"), type: "text" },
    { name: "industry", label: t("company.fields.industry"), type: "text" },
    { name: "country", label: t("company.fields.country"), type: "text" },
    { name: "address", label: t("company.fields.address"), type: "text", wide: true },
    { name: "email", label: t("company.fields.email"), type: "email" },
    { name: "phone", label: t("company.fields.phone"), type: "text" },
    { name: "website", label: t("company.fields.website"), type: "text" },
    { name: "logoUrl", label: t("company.fields.logo"), type: "textarea", hint: t("company.fields.logoHint") },
    { name: "reason", label: t("common.reason"), type: "textarea", required: true },
  ] as const;
}

/**
 * Where the company sits, and the controls that change it (Organizations PRD
 * §21, §22, §29-§32, §52-§54): assign a standalone company to a group, move a
 * group company to another group in one step, or make it standalone again;
 * suspend or reactivate. Every one asks for a reason and confirmation.
 */
export async function CompanyHeaderActions({ overview }: Props) {
  const t = await getTranslations("adminOrgs");
  const { company, structure, detach } = overview;
  const suspended = company.status !== "ACTIVE";
  if (company.status === "DELETED") {
    const withGroup = overview.deletedWithGroup;
    return <PlatformCommandMenu items={withGroup ? [] : [restoreItem({ kind: "company", id: company.id, name: company.name }, t), purgeItem({ kind: "company", id: company.id, name: company.name }, t)]} label={t("company.menu.actionsLabel", { name: company.name })} />;
  }
  const others = overview.groupOptions.filter((option) => option.value !== structure.group?.id);
  const menu: React.ComponentProps<typeof PlatformCommandMenu>["items"] = [
    { label: t("company.menu.edit"), title: t("company.menu.editTitle", { name: company.name }), action: "company.update", fixed: { companyId: company.id }, fields: companyFields(t).map((field) => ({ ...field })), initial: { ...company, logoUrl: company.logoUrl ?? "" }, submitLabel: t("company.menu.save"), success: t("company.menu.updated") },
    ...(structure.group && others.length ? [{
      label: t("company.menu.moveLabel"), title: t("company.menu.moveTitle", { name: company.name }),
      description: t("company.menu.moveDescription", { group: structure.group.name }),
      action: "company.move", fixed: { companyId: company.id },
      fields: [{ name: "groupId", label: t("company.menu.moveTo"), type: "select" as const, required: true, options: others }, { name: "reason", label: t("common.reason"), type: "textarea" as const, required: true }],
      submitLabel: t("company.menu.moveSubmit"), success: t("company.menu.moved"),
    }] : []),
    ...(structure.group && detach?.allowed ? [{
      label: t("company.menu.detachLabel"), title: t("company.menu.detachTitle", { name: company.name, group: structure.group.name }),
      description: [
        t("company.menu.detachBase"),
        detach.movingPeople ? t("company.menu.detachMoving", { count: detach.movingPeople }) : "",
        detach.groupLevelPeople.length ? t("company.menu.detachGroupLevel", { people: detach.groupLevelPeople.join(", ") }) : "",
      ].filter(Boolean).join(" "),
      action: "company.detach", fixed: { companyId: company.id }, reasonOnly: true, destructive: true, submitLabel: t("company.menu.detachSubmit"), success: t("company.menu.detached"),
    }] : []),
    suspended
      ? { label: t("company.menu.reactivateLabel"), title: t("company.menu.reactivateTitle", { name: company.name }), description: t("company.menu.reactivateDescription"), action: "company.status", fixed: { companyId: company.id, status: "ACTIVE" }, reasonOnly: true, submitLabel: t("company.menu.reactivateSubmit"), success: t("company.menu.reactivated") }
      : { label: t("company.menu.suspendLabel"), title: t("company.menu.suspendTitle", { name: company.name }), description: t("company.menu.suspendDescription"), action: "company.status", fixed: { companyId: company.id, status: "SUSPENDED" }, reasonOnly: true, destructive: true, submitLabel: t("company.menu.suspendSubmit"), success: t("company.menu.suspended") },
    deleteItem({ kind: "company", id: company.id, name: company.name }, RECOVERY_RETENTION_DAYS, t),
  ];
  return (
    <>
      {structure.group ? null : (
        <PlatformCommandButton
          label={t("company.assign.label")}
          title={t("company.assign.title", { name: company.name })}
          description={t("company.assign.description")}
          action="company.attach"
          fixed={{ companyId: company.id }}
          fields={[
            { name: "groupId", label: t("company.assign.groupField"), type: "select", required: true, options: overview.groupOptions },
            { name: "reason", label: t("common.reason"), type: "textarea", required: true },
          ]}
          submitLabel={t("company.assign.submit")}
          success={t("company.assign.success")}
        />
      )}
      <PlatformCommandMenu items={menu} label={t("company.menu.actionsLabel", { name: company.name })} />
    </>
  );
}

export async function DetachBlocked({ overview }: Props) {
  const t = await getTranslations("adminOrgs");
  const { structure, detach } = overview;
  if (!structure.group || !detach || detach.allowed) return null;
  return (
    <p className="nesto-card p-4 text-table text-fg-muted" data-testid="detach-blocked">
      {t("company.detachBlocked", { group: structure.group.name, people: detach.sharedPeople.join(", ") })}
    </p>
  );
}

/** The Overview tab: what can still be completed, the counts, recent history (§21, §57). */
const SETUP = {
  legal: "company.overview.setup.legal", registration: "company.overview.setup.registration", address: "company.overview.setup.address", contact: "company.overview.setup.contact", logo: "company.overview.setup.logo",
  group: "company.overview.setup.group", users: "company.overview.setup.users", projects: "company.overview.setup.projects", modules: "company.overview.setup.modules",
} as const;

/** The company's CEO: loaded for this actor; a failed load says so rather than showing "Not assigned" (PRD #12 §130). */
export async function CompanyLeadershipSection({ companyId }: { companyId: string }) {
  const t = await getTranslations("adminOrgs");
  const context = await requirePlatformContext();
  try {
    return <CompanyLeadershipCard leadership={await getCompanyLeadership(platformActor(context), { companyId })} />;
  } catch {
    return (
      <section className="nesto-card p-5" aria-labelledby="company-leadership">
        <h2 id="company-leadership" className="text-card font-semibold text-fg">{t("leadership.title")}</h2>
        <p role="alert" className="mt-2 text-table text-danger">{t("leadership.loadFailed")}</p>
        <Link href={`/admin/organizations/${companyId}`} className="text-table font-medium text-accent-strong hover:underline">{t("leadership.retry")}</Link>
      </section>
    );
  }
}

export async function CompanyOverview({ overview }: Props) {
  const t = await getTranslations("adminOrgs");
  const { company, counts, setup } = overview;
  const open = setup.filter((item) => !item.done).length;
  const setupLabel = (item: { key: string; label: string }) => (SETUP[item.key as keyof typeof SETUP] ? t(SETUP[item.key as keyof typeof SETUP]) : item.label);
  return (
    <div className="space-y-5">
      <DetachBlocked overview={overview} />
      <CompanyLeadershipSection companyId={company.id} />
      <section className="nesto-card p-5" aria-labelledby="company-counts">
        <h2 id="company-counts" className="text-card font-semibold text-fg">{t("company.overview.glance")}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {([[t("company.overview.users"), counts.users], [t("company.overview.employees"), counts.people], [t("company.overview.projects"), counts.projects], [t("company.overview.departments"), counts.departments], [t("company.overview.modulesOn"), counts.modules]] as const).map(([label, value]) => (
            <div key={label}>
              <dt className="text-meta text-fg-subtle">{label}</dt>
              <dd className="text-card font-semibold tabular-nums text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-meta text-fg-subtle">{overview.createdBy ? t("company.overview.createdBy", { date: formatDate(company.createdAt), name: overview.createdBy }) : t("company.overview.created", { date: formatDate(company.createdAt) })}</p>
      </section>

      <section className="nesto-card p-5" aria-labelledby="company-setup">
        <h2 id="company-setup" className="text-card font-semibold text-fg">{t("company.overview.setupTitle")}</h2>
        <p className="mt-1 text-table text-fg-muted">
          {open === 0 ? t("company.overview.setupDone") : t("company.overview.setupOptional")}
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="company-setup">
          {setup.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-table" data-done={item.done}>
              {item.done ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
              <span className={item.done ? "text-fg" : "text-fg-muted"}>
                {item.href && !item.done ? <Link href={item.href} className="hover:underline">{setupLabel(item)}</Link> : setupLabel(item)}
                <span className="sr-only">{item.done ? t("company.overview.done") : t("company.overview.notDone")}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="nesto-card p-5" aria-labelledby="company-history">
        <div className="flex items-center justify-between gap-3">
          <h2 id="company-history" className="text-card font-semibold text-fg">{t("company.overview.historyTitle")}</h2>
          <Link href={`/admin/audit?org=${company.id}`} className="text-table font-medium text-accent-strong hover:underline">{t("company.overview.openAudit")}</Link>
        </div>
        {overview.history.length === 0 ? (
          <p className="mt-3 text-table text-fg-muted">{t("company.overview.historyEmpty")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {overview.history.slice(0, 5).map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2 text-table">
                <span className="text-fg">{event.actionKey.replace(/^PLATFORM_/, "").toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase())}</span>
                <span className="text-fg-muted">{event.actor ?? t("common.system")} · {formatDate(event.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The Settings tab: General, Organization, Branding, Status (§42, §43). Every field optional but the name. */
export async function CompanySettings({ overview }: Props) {
  const t = await getTranslations("adminOrgs");
  const { company, structure } = overview;
  const rows: [string, string | null][] = [
    [t("company.fields.name"), company.name], [t("company.fields.legalName"), company.legalName], [t("company.fields.registrationNumber"), company.registrationNumber], [t("company.fields.taxNumber"), company.taxNumber],
    [t("company.fields.industry"), company.industry], [t("company.fields.country"), company.country], [t("company.fields.address"), company.address], [t("company.fields.email"), company.email], [t("company.fields.phone"), company.phone], [t("company.fields.website"), company.website],
  ];
  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="company-general">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="company-general" className="text-card font-semibold text-fg">{t("company.settings.general")}</h2>
          <PlatformCommandButton label={t("company.menu.edit")} title={t("company.menu.editTitle", { name: company.name })} action="company.update" fixed={{ companyId: company.id }} fields={companyFields(t).map((field) => ({ ...field }))} initial={{ ...company, logoUrl: company.logoUrl ?? "" }} success={t("company.menu.updated")} />
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{value || "—"}</dd></div>
          ))}
        </dl>
      </section>
      <section className="nesto-card p-5" aria-labelledby="company-organization">
        <h2 id="company-organization" className="text-card font-semibold text-fg">{t("company.settings.organization")}</h2>
        <p className="mt-2 text-body text-fg">
          {structure.group ? (() => { const [before, after] = t("company.settings.belongsTo", { group: "\u0001" }).split("\u0001"); return <>{before}<Link href={`/admin/organizations/${structure.group.id}`} className="text-accent-strong hover:underline">{structure.group.name}</Link>{after}</>; })() : t("company.settings.standaloneNote")}
        </p>
        <p className="mt-1 text-table text-fg-muted">{t("company.settings.controlsNote")}</p>
      </section>
      <section className="nesto-card p-5" aria-labelledby="company-branding">
        <h2 id="company-branding" className="text-card font-semibold text-fg">{t("company.settings.branding")}</h2>
        <p className="mt-2 text-table text-fg-muted">{company.logoUrl ? t("company.settings.logoSet") : t("company.settings.logoNone")}</p>
        <LogoUpload kind="company" id={company.id} name={company.name} logoUrl={company.logoUrl} />
      </section>
      <DetachBlocked overview={overview} />
    </div>
  );
}
