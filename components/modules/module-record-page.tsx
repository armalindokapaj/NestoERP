import { cache } from "react";
import { notFound, redirect } from "next/navigation";

import { ApprovalActions } from "@/components/modules/approval-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { modules, sectionRoute, type ModuleKey } from "@/config/modules";
import { can } from "@/lib/access/can";
import { resolveModuleExperience, resolveSection } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { findRecordSection } from "@/lib/modules/records/registry";

/**
 * The record detail page every department module shares (PRD #7 §31).
 *
 * Breadcrumb, header, status, metadata, actions — identical everywhere, so a
 * person who has learned one module has learned them all. A record outside the
 * caller's scope is a 404, never a 403 (PRD #7 §60).
 */
/**
 * The record and everything that decides whether it may be shown: the module,
 * the section, its permission, the record in the reader's scope. Cached per
 * request, so the shell's pre-stream guard and the page share one answer
 * (NAV-01 §2.1).
 */
export const loadModuleRecord = cache(async function loadModuleRecord(moduleKey: ModuleKey, requestedSection: string, recordId: string) {
  const context = await requireModule(moduleKey);
  const experience = resolveModuleExperience(context, moduleKey);
  const section = resolveSection(experience, requestedSection);

  if (!section) notFound();

  const records = findRecordSection(moduleKey, section.key);
  if (!records) notFound();
  if (!can(context, records.permission)) redirect("/access-denied");

  const record = await records.get(context, recordId);
  if (!record) notFound();
  return { context, section, records, record };
});

export async function ModuleRecordPage({
  moduleKey,
  section: requestedSection,
  recordId,
}: {
  moduleKey: ModuleKey;
  section: string;
  recordId: string;
}) {
  const { context, section, records, record } = await loadModuleRecord(moduleKey, requestedSection, recordId);

  const canDecide = Boolean(
    records.approvePermission && records.decide && can(context, records.approvePermission),
  );
  const closing = moduleKey === "qaqc" || moduleKey === "hse";

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: modules[moduleKey].label, href: modules[moduleKey].route },
          { label: section.label, href: sectionRoute(moduleKey, section.key) },
          { label: record.title },
        ]}
        title={record.title}
        subtitle={record.subtitle}
        status={record.status}
        actions={
          canDecide && record.approval?.pending ? (
            <ApprovalActions
              moduleKey={moduleKey}
              section={section.key}
              recordId={record.id}
              labels={closing ? { approve: "Close", reject: "Reopen" } : undefined}
            />
          ) : null
        }
      />

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Details</h2>
        {record.description ? (
          <p className="mt-3 text-body text-fg-muted">{record.description}</p>
        ) : null}
        <DetailGrid className="mt-5" items={record.fields} />
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Record</h2>
        <DetailGrid className="mt-4" columns={3} items={record.meta} />
      </section>
    </div>
  );
}
