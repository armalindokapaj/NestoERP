import type { Metadata } from "next";

import type { SearchParams } from "@/components/engineering/page-helpers";
import { ProjectSubmittalRegister } from "@/components/engineering/project-registers";
import { requireModule } from "@/lib/context/current-user";

type Params = { params: Promise<{ projectId: string }>; searchParams: SearchParams };

export const metadata: Metadata = { title: "Submittals" };

/** The project's submittal register (PRD #46 §98-§109, §168). */
export default async function Page({ params, searchParams }: Params) {
  const [{ projectId }, search] = await Promise.all([params, searchParams]);
  const context = await requireModule("engineering");
  return <ProjectSubmittalRegister context={context} projectId={projectId} params={search} view="all" />;
}
