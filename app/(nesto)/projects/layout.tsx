import type { Metadata } from "next";

import { ModuleMessages } from "@/components/i18n/module-messages";
import { getTranslations } from "@/lib/i18n/server";

import { requireProjectPortfolio } from "./portfolio-access";

export async function generateMetadata(): Promise<Metadata> {
  const projects = (await getTranslations("projects"))("meta.projects");
  return { title: { default: projects, template: `%s · ${projects} · NESTO` } };
}

/**
 * Guards the whole module in one place (PRD #10 §5, §157; E-05A §28).
 *
 * The door is "can open projects in at least one of your companies", not only
 * the session's company — the Projects page gathers every company's projects.
 * Pages that work inside the session's company (Milestones, Archived, a project
 * itself) keep their own company guard on top of this one.
 *
 * A company that switched Projects off gets "module unavailable"; a role
 * without access gets "access denied". They are different answers to different
 * problems (PRD #7 §58, §59).
 */
export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireProjectPortfolio();
  return <ModuleMessages namespaces={["projects", "finance", "sales", "contracts", "meetings", "documents"]}>{children}</ModuleMessages>;
}
