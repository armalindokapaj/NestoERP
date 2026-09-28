import { ModuleMessages } from "@/components/i18n/module-messages";
import { requireModule } from "@/lib/context/current-user";

/** Guards the module once, for every route beneath it (PRD #7 §58, §59). */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  await requireModule("team");
  return <ModuleMessages namespaces={["team"]}>{children}</ModuleMessages>;
}
