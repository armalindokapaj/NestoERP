import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";

/**
 * Every authenticated NESTO route renders inside the one application shell
 * (spec §3, §9). Middleware has already checked the session; requireUser is the
 * second line of defence and provides the user context.
 */
export default async function NestoLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return <AppShell user={user}>{children}</AppShell>;
}
