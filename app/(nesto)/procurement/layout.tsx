import { requireModule } from "@/lib/context/current-user";

/**
 * Guards the module once, for every route beneath it (PRD #7 §58, §59).
 *
 * A company that switched the module off gets "module unavailable"; a role
 * without access gets "access denied".
 */
export default async function ModuleLayout({ children }: { children: React.ReactNode }) {
  await requireModule("procurement");
  return <>{children}</>;
}
