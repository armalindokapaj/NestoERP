import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TemplateActions } from "@/components/qaqc/template-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as templates from "@/lib/modules/qaqc/templates/template.service";
import {
  inspectionTypeLabels,
  responseTypeLabels,
} from "@/lib/modules/qaqc/qaqc.status";
import { formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ templateId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { templateId } = await params;
  try {
    const context = await requireModule("qaqc");
    const template = await templates.getTemplate(context, templateId);
    return { title: `${template.code} v${template.version}` };
  } catch {
    return { title: "Inspection template" };
  }
}

/** One template (PRD #21 §50, §53, §54). */
export default async function TemplatePage({ params }: Params) {
  const { templateId } = await params;
  const context = await requireModule("qaqc");

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
          { label: "QA/QC", href: "/qaqc" },
          { label: "Templates", href: "/qaqc/templates" },
          { label: `${template.code} v${template.version}` },
        ]}
        title={template.name}
        subtitle={`${template.code} · version ${template.version}`}
        status={template.status}
        badges={<Badge tone="neutral">{inspectionTypeLabels[template.inspectionType]}</Badge>}
        meta={[
          { label: "Checks", value: String(template.itemCount) },
          { label: "Inspections run", value: String(template.usageCount) },
        ]}
        actions={<TemplateActions template={template} />}
      />

      {template.usageCount > 0 ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {template.usageCount} inspection{template.usageCount === 1 ? " has" : "s have"} been run
          against this version. Editing it writes version {template.version + 1} rather than
          changing what those inspections were held to.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Checks</h2>
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
                      {responseTypeLabels[item.responseType]}
                    </span>
                  </div>

                  {item.passCriteriaText ? (
                    <p className="mt-1 text-meta text-fg-subtle">
                      <span className="font-medium text-fg-muted">Passes when:</span>{" "}
                      {item.passCriteriaText}
                    </p>
                  ) : null}

                  {item.requiresEvidenceOnFail ? (
                    <p className="mt-1 text-meta text-fg-subtle">
                      A failure on this check has to be explained before the inspection can be
                      submitted.
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          {template.description ? (
            <section className="nesto-card p-5">
              <h2 className="text-card font-semibold text-fg">Description</h2>
              <p className="mt-2 whitespace-pre-wrap text-table text-fg-muted">
                {template.description}
              </p>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="nesto-card p-5">
            <h2 className="text-card font-semibold text-fg">Record</h2>
            <DetailGrid
              className="mt-4"
              items={[
                { label: "Created by", value: orDash(template.createdBy?.fullName ?? null) },
                { label: "Created", value: formatDateTime(template.createdAt) },
                { label: "Updated", value: formatDateTime(template.updatedAt) },
                ...(template.archivedAt
                  ? [{ label: "Archived", value: formatDateTime(template.archivedAt) }]
                  : []),
              ]}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
