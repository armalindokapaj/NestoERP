import { TabPendingDot } from "@/components/modules/tab-pending-dot";
import { sectionLabel } from "@/lib/i18n/modules/common/labels";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { KeepActiveInView } from "@/components/ui/scroll-region";
import { sectionRoute } from "@/config/modules";
import type { ResolvedModuleExperience } from "@/lib/access/module-access";
import { ContextTabsFrame, contextTabClass } from "@/components/navigation/context-tabs-frame";

/**
 * Module sub-navigation (PRD #7 §14).
 *
 * Tabs are routes, not local state: `/projects/archived`, not `/projects?tab=archived`.
 * Deep links, refresh and back/forward therefore work without any extra code,
 * and only permitted tabs are rendered at all (PRD #5 §30).
 *
 * When tabs exceed the width they scroll horizontally rather than wrapping into
 * unreadable rows (PRD #7 §89). The active tab is scrolled into view, each
 * tab is a 44px target under touch, and the focus ring is drawn inside the tab
 * so the scroll box cannot clip it (AUD-04 §4, SP-09, MW-02, MW-19).
 */
export async function ModuleTabs({
  experience,
  activeSection,
}: {
  experience: ResolvedModuleExperience;
  activeSection: string;
}) {
  if (experience.sections.length <= 1) return null;
  // The module is named as the sidebar names it and each tab as its section is
  // configured, both in the reader's language; config/modules.ts keeps the English.
  const [t, names] = await Promise.all([getTranslations("common"), getTranslations("modules")]);

  return (
    <ContextTabsFrame label={t("sections", { label: names(`${experience.module}.label`) })}>
        {experience.sections.map((section) => {
          const active = section.key === activeSection;
          return (
            <Link
              key={section.key}
              href={sectionRoute(experience.module, section.key)}
              navSource="tab"
              aria-current={active ? "page" : undefined}
              className={contextTabClass(active)}
            >
              {sectionLabel(t, experience.module, section)}
              <TabPendingDot href={sectionRoute(experience.module, section.key)} />
            </Link>
          );
        })}
        <KeepActiveInView activeKey={activeSection} />
    </ContextTabsFrame>
  );
}
