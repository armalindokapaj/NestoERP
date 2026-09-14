import type { Metadata } from "next";

import type { SearchParams } from "@/components/engineering/page-helpers";
import { ProjectDocumentRegister } from "@/components/engineering/project-registers";
import { requireModule } from "@/lib/context/current-user";

type Params = { params: Promise<{ projectId: string }>; searchParams: SearchParams };

export const metadata: Metadata = { title: "Engineering documents" };

/** Every controlled technical document on the project (PRD #46 §59-§65, §217). */
export default async function Page({ params, searchParams }: Params) {
  const [{ projectId }, search] = await Promise.all([params, searchParams]);
  const context = await requireModule("engineering");
  return <ProjectDocumentRegister context={context} projectId={projectId} params={search} drawings={false} />;
}
