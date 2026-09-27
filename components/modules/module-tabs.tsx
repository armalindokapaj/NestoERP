import { TabPendingDot } from "@/components/modules/tab-pending-dot";
import { getTranslations } from "@/lib/i18n/server";
import Link from "@/components/navigation/nav-link";
import { KeepActiveInView } from "@/components/ui/scroll-region";
import { sectionRoute } from "@/config/modules";
import type { ResolvedModuleExperience } from "@/lib/access/module-access";
import { cn } from "@/lib/utils/cn";

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
  const t = await getTranslations("common");

  return (
    <div className="-mx-1 overflow-x-auto overscroll-x-contain">
      <nav
        aria-label={t("sections", { label: experience.label })}
        className="flex min-w-max items-center gap-1 border-b border-line px-1"
      >
        {experience.sections.map((section) => {
          const active = section.key === activeSection;
          return (
            <Link
              key={section.key}
              href={sectionRoute(experience.module, section.key)}
              navSource="tab"
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative -mb-px inline-flex items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-table font-medium transition-colors touch:min-h-11",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {section.label}
              <TabPendingDot href={sectionRoute(experience.module, section.key)} />
            </Link>
          );
        })}
        <KeepActiveInView activeKey={activeSection} />
      </nav>
    </div>
  );
}
