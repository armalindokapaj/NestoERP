import { requireModule } from "@/lib/context/current-user";

/** Guards the module once, for every route beneath it (PRD #7 §58, §59). */
export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  await requireModule("company");
  return <>{children}</>;
}
