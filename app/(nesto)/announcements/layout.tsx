import { requireModule } from "@/lib/context/current-user";

/** Guards the module once, for every route beneath it (PRD #45 §58). */
export default async function AnnouncementsLayout({ children }: { children: React.ReactNode }) {
  await requireModule("announcements");
  return <>{children}</>;
}
