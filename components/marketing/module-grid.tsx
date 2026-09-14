import { getIcon } from "@/components/layout/nav-icon";
import { gridColumns, hairlineCell, hairlineGrid } from "@/components/marketing/section";
import {
  MODULE_GROUPS,
  moduleList,
  type ModuleDefinition,
  type ModuleGroup,
} from "@/config/modules";
import type { Translate } from "@/lib/i18n/translator";
import { getSiteCopy, getTranslations } from "@/lib/i18n/server";
import { configLabel, type SiteCopy } from "@/lib/i18n/site";
import { cn } from "@/lib/utils/cn";

/**
 * The module set, on the public site.
 *
 * Labels, icons, zones and tabs are read from config/modules.ts — the same file
 * the sidebar and the router read — and named in the reader's language. A module added to the product appears here
 * without anyone remembering to update a marketing page, and the site can never
 * advertise a module that does not exist.
 */

function ModuleCard({
  definition,
  showTabs = false,
  copy,
  t,
}: {
  definition: ModuleDefinition;
  showTabs?: boolean;
  copy: SiteCopy;
  t: Translate<"modules">;
}) {
  const ModuleIcon = getIcon(definition.icon);

  return (
    <article className={cn(hairlineCell, "flex flex-col p-6 transition-colors hover:bg-row-hover")}>
      <ModuleIcon aria-hidden="true" className="size-5 text-fg-subtle" />
      <h3 className="mt-4 text-card font-semibold text-fg">{t(`${definition.key}.label`)}</h3>
      <p className="mt-2 text-table leading-relaxed text-fg-muted">
        {copy.moduleCopy[definition.key]}
      </p>

      {showTabs && definition.sections.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {definition.sections.map((section) => (
            <li
              key={section.key}
              className="rounded-full border border-line bg-canvas px-2 py-0.5 text-micro text-fg-subtle"
            >
              {configLabel(copy, "sections", section.label)}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export async function ModuleGrid({
  zones = ["work", "department", "company"],
  showTabs = false,
  className,
}: {
  zones?: ModuleGroup[];
  showTabs?: boolean;
  className?: string;
}) {
  const [copy, t] = await Promise.all([getSiteCopy(), getTranslations("modules")]);
  const ordered = MODULE_GROUPS.filter((group) => zones.includes(group));

  return (
    <div className={cn("space-y-12", className)}>
      {ordered.map((zone) => {
        const inZone = moduleList.filter((definition) => definition.group === zone);
        if (inZone.length === 0) return null;
        const zoneCopy = copy.moduleZones[zone];

        return (
          <section key={zone}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h3 className="nesto-eyebrow text-fg">{zoneCopy.title}</h3>
              <p className="text-table text-fg-subtle">{zoneCopy.lead}</p>
              <span className="ml-auto text-micro tabular-nums text-fg-subtle">
                {String(inZone.length).padStart(2, "0")}
              </span>
            </div>

            <div className={cn(hairlineGrid, gridColumns(inZone.length), "mt-5")}>
              {inZone.map((definition) => (
                <ModuleCard
                  key={definition.key}
                  definition={definition}
                  showTabs={showTabs}
                  copy={copy}
                  t={t}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
