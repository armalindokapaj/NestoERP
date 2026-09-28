import { ModuleMessages } from "@/components/i18n/module-messages";
import { requireModule } from "@/lib/context/current-user";

/** Guards the module once, for every route beneath it (PRD #7 §58, §59). */
export default async function PeopleLayout({ children }: { children: React.ReactNode }) {
  await requireModule("people");
  return <ModuleMessages namespaces={["people", "workforce", "hr"]}>{children}</ModuleMessages>;
}
