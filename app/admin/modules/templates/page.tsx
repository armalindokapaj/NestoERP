import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePlatformContext } from "@/lib/context/platform-context";
import { getTranslations } from "@/lib/i18n/server";
import { platformTemplates } from "@/lib/modules/platform/platform-control.query";

export async function generateMetadata() {
  const t = await getTranslations("adminOrgs");
  return { title: t("meta.templates") };
}

export default async function TemplatesPage() {
  const t = await getTranslations("adminOrgs");
  const context = await requirePlatformContext();
  const data = await platformTemplates(context);
  const sets = [
    { title: t("templates.projectTypes"), rows: data.projectTypes, note: t("templates.projectTypesNote") },
    { title: t("templates.quality"), rows: data.qualityTemplates, note: t("templates.qualityNote") },
    { title: t("templates.hse"), rows: data.hseTemplates, note: t("templates.hseNote") },
  ];
  return <div className="space-y-5"><PageHeader title={t("templates.title")} description={t("templates.description")} /><div className="grid gap-4 xl:grid-cols-3">{sets.map((set) => <Card key={set.title} className="p-5"><div className="flex items-center justify-between"><h2 className="text-card font-semibold text-fg">{set.title}</h2><Badge>{set.rows.length}</Badge></div><p className="mt-1 text-table text-fg-muted">{set.note}</p><div className="mt-4 divide-y divide-line border-t border-line">{set.rows.slice(0, 12).map((row) => <div key={row.id} className="py-3"><p className="text-table font-medium text-fg">{row.name}</p><p className="text-meta text-fg-subtle">{row.company.parentGroup.name} · {row.company.name}</p></div>)}</div></Card>)}</div></div>;
}
