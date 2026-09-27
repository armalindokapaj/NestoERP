import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";

import type { SearchParams } from "@/components/engineering/page-helpers";
import { ProjectSubmittalRegister } from "@/components/engineering/project-registers";
import { requireModule } from "@/lib/context/current-user";

type Params = { params: Promise<{ projectId: string }>; searchParams: SearchParams };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("engineering.methodStatements") };
}

/** Method statements: submittals of that type, reviewed like any other (PRD #46 §110-§113). */
export default async function Page({ params, searchParams }: Params) {
  const [{ projectId }, search] = await Promise.all([params, searchParams]);
  const context = await requireModule("engineering");
  return <ProjectSubmittalRegister context={context} projectId={projectId} params={search} view="method" />;
}
