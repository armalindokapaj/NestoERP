import type { Metadata } from "next";

import { requireModule } from "@/lib/context/current-user";

export const metadata: Metadata = {
  title: { default: "Projects", template: "%s · Projects · NESTO" },
};

/**
 * Guards the whole module in one place (PRD #10 §5, §157).
 *
 * A company that switched Projects off gets "module unavailable"; a role
 * without access gets "access denied". They are different answers to different
 * problems (PRD #7 §58, §59).
 */
export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireModule("projects");
  return <>{children}</>;
}
