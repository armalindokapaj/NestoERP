import type { Metadata } from "next";

import type { SearchParams } from "@/components/engineering/page-helpers";
import { ProjectRfiRegister } from "@/components/engineering/project-registers";
import { requireModule } from "@/lib/context/current-user";

type Params = { params: Promise<{ projectId: string }>; searchParams: SearchParams };

export const metadata: Metadata = { title: "RFIs" };

/** The project's RFI register (PRD #46 §82-§97, §167). */
export default async function Page({ params, searchParams }: Params) {
  const [{ projectId }, search] = await Promise.all([params, searchParams]);
  const context = await requireModule("engineering");
  return <ProjectRfiRegister context={context} projectId={projectId} params={search} />;
}
