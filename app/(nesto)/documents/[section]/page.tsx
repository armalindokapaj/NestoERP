import { ModuleSectionPage } from "@/components/modules/module-section-page";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  return (
    <ModuleSectionPage
      moduleKey="documents"
      section={section}
      searchParams={await searchParams}
    />
  );
}
