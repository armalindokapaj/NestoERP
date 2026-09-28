import Link from "@/components/navigation/nav-link";
import { CheckCircle2, Circle } from "lucide-react";

import { PlatformCommandButton } from "@/components/platform/platform-command";
import { formatDate } from "@/lib/utils/format";
import type { getPlatformCompanyOverview } from "@/lib/modules/platform/platform-company.service";

type Overview = Awaited<ReturnType<typeof getPlatformCompanyOverview>>;
type Props = { overview: Overview };

export const COMPANY_FIELDS = [
  { name: "name", label: "Company name", type: "text", required: true },
  { name: "legalName", label: "Legal name", type: "text" },
  { name: "registrationNumber", label: "Registration number / NUIS", type: "text" },
  { name: "taxNumber", label: "VAT / Tax ID", type: "text" },
  { name: "industry", label: "Industry", type: "text" },
  { name: "country", label: "Country", type: "text" },
  { name: "address", label: "Address", type: "text", wide: true },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "text" },
  { name: "website", label: "Website", type: "text" },
  { name: "logoUrl", label: "Logo", type: "textarea", hint: "A path on this deployment (/branding/logo.svg) or an inline image (data:image/png;base64,…). Leave empty for initials." },
  { name: "reason", label: "Reason", type: "textarea", required: true },
] as const;

/**
 * Where the company sits, and the controls that change it (Organizations PRD
 * §21, §22, §29-§32, §52-§54): assign a standalone company to a group, move a
 * group company to another group in one step, or make it standalone again;
 * suspend or reactivate. Every one asks for a reason and confirmation.
 */
export function CompanyHeaderActions({ overview }: Props) {
  const { company, structure, detach } = overview;
  const suspended = company.status !== "ACTIVE";
  const others = overview.groupOptions.filter((option) => option.value !== structure.group?.id);
  return (
    <>
      {structure.group ? (
        <>
          {others.length ? (
            <PlatformCommandButton
              label="Move to group"
              title={`Move ${company.name}?`}
              description={`From ${structure.group.name} to the group you choose. Company data and projects stay unchanged; group-wide access from ${structure.group.name} ends here.`}
              action="company.move"
              fixed={{ companyId: company.id }}
              fields={[
                { name: "groupId", label: "To", type: "select", required: true, options: others },
                { name: "reason", label: "Reason", type: "textarea", required: true },
              ]}
              submitLabel="Move Company"
              success="Company moved."
            />
          ) : null}
          {detach?.allowed ? (
            <PlatformCommandButton
              label="Remove from group"
              title={`Remove ${company.name} from ${structure.group.name}?`}
              description={[
                "The company will become a standalone company. Its projects, users and data will not be deleted.",
                detach.movingPeople ? `${detach.movingPeople} ${detach.movingPeople === 1 ? "person moves" : "people move"} with it.` : "",
                detach.groupLevelPeople.length ? `Group-level access ends here for: ${detach.groupLevelPeople.join(", ")}.` : "",
              ].filter(Boolean).join(" ")}
              action="company.detach"
              fixed={{ companyId: company.id }}
              reasonOnly
              destructive
              submitLabel="Remove From Group"
              success="Company is now standalone."
            />
          ) : null}
        </>
      ) : (
        <PlatformCommandButton
          label="Assign to group"
          title={`Assign ${company.name} to a Parent Group`}
          description="The company keeps its ID, users, projects, documents, units, contracts, permissions, modules and history. Its people and departments join the group; nothing group-wide travels with it."
          action="company.attach"
          fixed={{ companyId: company.id }}
          fields={[
            { name: "groupId", label: "Parent Group", type: "select", required: true, options: overview.groupOptions },
            { name: "reason", label: "Reason", type: "textarea", required: true },
          ]}
          submitLabel="Assign to Group"
          success="Company assigned to the group."
        />
      )}
      {suspended ? (
        <PlatformCommandButton label="Reactivate" title={`Reactivate ${company.name}?`} description="Its users regain access according to their memberships. Nothing was deleted while it was inactive." action="company.status" fixed={{ companyId: company.id, status: "ACTIVE" }} reasonOnly submitLabel="Reactivate" success="Company reactivated." />
      ) : (
        <PlatformCommandButton label="Suspend" title={`Suspend ${company.name}?`} description="Users will lose normal access to this company until it is reactivated. No company data will be deleted." action="company.status" fixed={{ companyId: company.id, status: "SUSPENDED" }} reasonOnly destructive variant="danger" submitLabel="Suspend Company" success="Company suspended." />
      )}
    </>
  );
}

export function DetachBlocked({ overview }: Props) {
  const { structure, detach } = overview;
  if (!structure.group || !detach || detach.allowed) return null;
  return (
    <p className="nesto-card p-4 text-table text-fg-muted" data-testid="detach-blocked">
      It cannot leave {structure.group.name} while these people also work in another of its companies: {detach.sharedPeople.join(", ")}.
    </p>
  );
}

/** The Overview tab: what can still be completed, the counts, recent history (§21, §57). */
export function CompanyOverview({ overview }: Props) {
  const { company, counts, setup } = overview;
  const open = setup.filter((item) => !item.done).length;
  return (
    <div className="space-y-5">
      <DetachBlocked overview={overview} />
      <section className="nesto-card p-5" aria-labelledby="company-counts">
        <h2 id="company-counts" className="text-card font-semibold text-fg">At a glance</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {([["Users", counts.users], ["Employees", counts.people], ["Projects", counts.projects], ["Departments", counts.departments], ["Modules on", counts.modules]] as const).map(([label, value]) => (
            <div key={label}>
              <dt className="text-meta text-fg-subtle">{label}</dt>
              <dd className="text-card font-semibold tabular-nums text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-meta text-fg-subtle">Created {formatDate(company.createdAt)}{overview.createdBy ? ` by ${overview.createdBy}` : ""}</p>
      </section>

      <section className="nesto-card p-5" aria-labelledby="company-setup">
        <h2 id="company-setup" className="text-card font-semibold text-fg">Complete setup</h2>
        <p className="mt-1 text-table text-fg-muted">
          {open === 0 ? "Everything is set up." : "Optional. None of this blocks the company from working, and it can be completed at any time."}
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="company-setup">
          {setup.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-table" data-done={item.done}>
              {item.done ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-subtle" />}
              <span className={item.done ? "text-fg" : "text-fg-muted"}>
                {item.href && !item.done ? <Link href={item.href} className="hover:underline">{item.label}</Link> : item.label}
                <span className="sr-only">{item.done ? " — done" : " — not done"}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="nesto-card p-5" aria-labelledby="company-history">
        <div className="flex items-center justify-between gap-3">
          <h2 id="company-history" className="text-card font-semibold text-fg">Recent history</h2>
          <Link href="/admin/audit" className="text-table font-medium text-accent-strong hover:underline">Audit Log</Link>
        </div>
        {overview.history.length === 0 ? (
          <p className="mt-3 text-table text-fg-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {overview.history.slice(0, 5).map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-2 py-2 text-table">
                <span className="text-fg">{event.actionKey.replace(/^PLATFORM_/, "").toLowerCase().replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase())}</span>
                <span className="text-fg-muted">{event.actor ?? "System"} · {formatDate(event.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The Settings tab: General, Organization, Branding, Status (§42, §43). Every field optional but the name. */
export function CompanySettings({ overview }: Props) {
  const { company, structure } = overview;
  const rows: [string, string | null][] = [
    ["Company name", company.name], ["Legal name", company.legalName], ["Registration number / NUIS", company.registrationNumber], ["VAT / Tax ID", company.taxNumber],
    ["Industry", company.industry], ["Country", company.country], ["Address", company.address], ["Email", company.email], ["Phone", company.phone], ["Website", company.website],
  ];
  return (
    <div className="space-y-5">
      <section className="nesto-card p-5" aria-labelledby="company-general">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="company-general" className="text-card font-semibold text-fg">General</h2>
          <PlatformCommandButton label="Edit" title={`Edit ${company.name}`} action="company.update" fixed={{ companyId: company.id }} fields={COMPANY_FIELDS.map((field) => ({ ...field }))} initial={{ ...company, logoUrl: company.logoUrl ?? "" }} success="Company updated." />
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}><dt className="text-meta text-fg-subtle">{label}</dt><dd className="text-body text-fg">{value || "—"}</dd></div>
          ))}
        </dl>
      </section>
      <section className="nesto-card p-5" aria-labelledby="company-organization">
        <h2 id="company-organization" className="text-card font-semibold text-fg">Organization</h2>
        <p className="mt-2 text-body text-fg">
          {structure.group ? <>Belongs to <Link href={`/admin/organizations/${structure.group.id}`} className="text-accent-strong hover:underline">{structure.group.name}</Link>.</> : "Standalone company — no Parent Group."}
        </p>
        <p className="mt-1 text-table text-fg-muted">Assign, move or remove with the controls at the top of the page.</p>
      </section>
      <section className="nesto-card p-5" aria-labelledby="company-branding">
        <h2 id="company-branding" className="text-card font-semibold text-fg">Branding</h2>
        <p className="mt-2 text-table text-fg-muted">{company.logoUrl ? "A logo is set; it stands for the company in its workspace." : "No logo — the company's initials stand in."}</p>
      </section>
      <DetachBlocked overview={overview} />
    </div>
  );
}
