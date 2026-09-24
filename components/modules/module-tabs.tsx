import { TabPendingDot } from "@/components/modules/tab-pending-dot";
import Link from "@/components/navigation/nav-link";
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
 * unreadable rows (PRD #7 §89).
 */
export function ModuleTabs({
  experience,
  activeSection,
}: {
  experience: ResolvedModuleExperience;
  activeSection: string;
}) {
  if (experience.sections.length <= 1) return null;

  return (
    <div className="-mx-1 overflow-x-auto">
      <nav
        aria-label={`${experience.label} sections`}
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
                "relative -mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-table font-medium transition-colors",
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
      </nav>
    </div>
  );
}
