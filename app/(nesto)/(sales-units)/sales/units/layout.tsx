import { ModuleMessages } from "@/components/i18n/module-messages";
import { requireModule } from "@/lib/context/current-user";

/**
 * Sales units (/sales/units; docs/unit-sales.md).
 *
 * The address is Sales', the door is Projects': everyone who can see units
 * opens it, whether or not they may open the Sales module, so it sits in its
 * own route group, outside `app/(nesto)/sales/layout.tsx` and its guard. What
 * each reader sees of a unit's sale is decided by the unit grants, page by page.
 */
export default async function SalesUnitsLayout({ children }: { children: React.ReactNode }) {
  await requireModule("projects");
  return <ModuleMessages namespaces={["projects", "sales", "finance", "contracts", "documents"]}>{children}</ModuleMessages>;
}
