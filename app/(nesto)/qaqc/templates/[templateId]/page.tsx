import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import { TemplateActions } from "@/components/qaqc/template-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as templates from "@/lib/modules/qaqc/templates/template.service";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";
import { formatDateTime } from "@/lib/utils/format";

type Params = { params: Promise<{ templateId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { templateId } = await params;
  try {
    const context = await requireModule("qaqc");
    const template = await templates.getTemplate(context, templateId);
    return { title: `${template.code} v${template.version}` };
  } catch {
    const t = await getTranslations("qaqc");
    return { title: t("meta.template") };
  }
}

/** One template (PRD #21 §50, §53, §54). */
export default async function TemplatePage({ params }: Params) {
  const { templateId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let template;
  try {
    template = await templates.getTemplate(context, templateId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.templates"), href: "/qaqc/templates" },
          { label: `${template.code} v${template.version}` },
        ]}
        title={template.name}
        subtitle={t("templatePage.version", { code: template.code, version: template.version })}
        status={template.status}
        badges={<Badge tone="neutral">{qaqcLabel(t, "inspectionType", template.inspectionType)}</Badge>}
        meta={[
          { label: t("templatePage.checks"), value: String(template.itemCount) },
          { label: t("templatePage.inspectionsRun"), value: String(template.usageCount) },
        ]}
        actions={<TemplateActions template={template} />}
      />

      {template.usageCount > 0 ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {t("templatePage.usage", { count: template.usageCount, next: template.version + 1 })}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("templatePage.checks")}</h2>
            <ol className="mt-4 divide-y divide-line">
              {template.items.map((item, index) => (
                <li key={item.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-table font-medium text-fg">
                      <span className="text-fg-subtle">{index + 1}. </span>
                      {item.code ? <span className="text-fg-subtle">{item.code} · </span> : null}
                      {item.label}
                      {item.required ? (
                        <span className="ml-0.5 text-danger-strong" aria-hidden="true">
                          *
                        </span>
                      ) : null}
                    </p>
                    <span className="shrink-0 text-meta text-fg-subtle">
                      {qaqcLabel(t, "responseType", item.responseType)}
                    </span>
                  </div>

                  {item.passCriteriaText ? (
                    <p className="mt-1 text-meta text-fg-subtle">
                      <span className="font-medium text-fg-muted">{t("detail.passesWhen")}</span>{" "}
                      {item.passCriteriaText}
                    </p>
                  ) : null}

                  {item.requiresEvidenceOnFail ? (
                    <p className="mt-1 text-meta text-fg-subtle">
                      {t("templatePage.evidenceNote")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          {template.description ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">{t("templatePage.description")}</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {template.description}
              </p>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">{t("detail.record")}</h2>
            <DetailGrid
              className="mt-4"
              items={[
                {
                  label: t("detail.createdBy"),
                  value: template.createdBy ? (
                    <PersonLink memberId={template.createdBy.memberId} name={template.createdBy.fullName} />
                  ) : (
                    "—"
                  ),
                },
                { label: t("detail.created"), value: formatDateTime(template.createdAt) },
                { label: t("detail.updated"), value: formatDateTime(template.updatedAt) },
                ...(template.archivedAt
                  ? [{ label: t("detail.archived"), value: formatDateTime(template.archivedAt) }]
                  : []),
              ]}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
