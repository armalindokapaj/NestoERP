import { notFound, redirect } from "next/navigation";

import { HelpIndex } from "@/components/help/help-page";
import { ModulePage } from "@/components/modules/module-page";
import { RecordList } from "@/components/modules/record-list";
import { modules, sectionRoute, type ModuleKey } from "@/config/modules";
import { can } from "@/lib/access/can";
import { resolveModuleExperience, resolveSection } from "@/lib/access/module-access";
import { requireModule } from "@/lib/context/current-user";
import { helpAccess } from "@/lib/help/help-access";
import { findRecordSection } from "@/lib/modules/records/registry";
import { ModuleOverview } from "./module-overview";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Renders one module section from configuration (PRD #7 §11, §14).
 *
 * The module's own route files are three lines each; everything about what a
 * section contains, who may see it and how it is queried lives in the module
 * registry and the record registry. That is what stops Finance, HR and
 * Procurement from becoming three separate UI systems (PRD #7 §162).
 */
export async function ModuleSectionPage({
  moduleKey,
  section: requestedSection,
  searchParams,
}: {
  moduleKey: ModuleKey;
  section?: string;
  searchParams: SearchParams;
}) {
  const context = await requireModule(moduleKey);
  const experience = resolveModuleExperience(context, moduleKey);

  const section = resolveSection(experience, requestedSection);

  if (!section) {
    // The section either does not exist, or this role may not open it. Both are
    // answered the same way, so the URL cannot be used to enumerate tabs.
    if (requestedSection) notFound();
    redirect("/access-denied");
  }

  const definition = modules[moduleKey];
  const basePath = sectionRoute(moduleKey, section.key);

  // The module root renders the module's own overview (PRD #7 §15).
  if (section.key === definition.defaultSection && section.key === "overview") {
    return (
      <ModulePage experience={experience} activeSection={section.key}>
        <ModuleOverview context={context} moduleKey={moduleKey} />
      </ModulePage>
    );
  }

  // Support's Help tab is the module Help index, not a second copy of Support's overview (AUD-05 §7, UX-16).
  if (moduleKey === "support" && section.key === "help") {
    const access = await helpAccess(context);
    return (
      <ModulePage experience={experience} activeSection={section.key}>
        <HelpIndex modules={access.modules} embedded />
      </ModulePage>
    );
  }

  const records = findRecordSection(moduleKey, section.key);

  if (!records) {
    return (
      <ModulePage experience={experience} activeSection={section.key}>
        <ModuleOverview context={context} moduleKey={moduleKey} />
      </ModulePage>
    );
  }

  // A section's own permission is checked again here, so reaching it by URL is
  // no different from reaching it by tab (PRD #5 §61).
  if (!can(context, records.permission)) redirect("/access-denied");

  const page = Math.max(1, Number.parseInt(firstValue(searchParams.page) ?? "1", 10) || 1);
  const limit = 25;

  const filters: Record<string, string> = {};
  for (const filter of records.filters ?? []) {
    const value = firstValue(searchParams[filter.param]);
    if (value) filters[filter.param] = value;
  }

  const result = await records.list(context, {
    search: firstValue(searchParams.search),
    filters,
    page,
    limit,
  });

  return (
    <ModulePage experience={experience} activeSection={section.key}>
      <RecordList
        section={records}
        rows={result.rows}
        total={result.total}
        page={page}
        limit={limit}
        basePath={basePath}
        searchParams={searchParams}
      />
    </ModulePage>
  );
}
