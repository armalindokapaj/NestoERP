import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TemplateLifecycle } from "@/components/hse/template-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as templates from "@/lib/modules/hse/templates/template.service";
import {
  inspectionTypeLabels,
  responseTypeLabels,
  severityLabels,
} from "@/lib/modules/hse/hse.status";
import { formatDateTime, orDash } from "@/lib/utils/format";

type Params = { params: Promise<{ templateId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { templateId } = await params;
  try {
    const context = await requireModule("hse");
    const template = await templates.getTemplate(context, templateId);
    return { title: template.code };
  } catch {
    return { title: "Checklist" };
  }
}

/** One safety checklist (PRD #22 §43, §45, §349). */
export default async function TemplatePage({ params }: Params) {
  const { templateId } = await params;
  const context = await requireModule("hse");

  let template;
  try {
    template = await templates.getTemplate(context, templateId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const may = template.capabilities;

  return (
    <div className="space-y-5">
      <RecordHeader
        breadcrumbs={[
          { label: "HSE", href: "/hse" },
          { label: "Checklists", href: "/hse/templates" },
          { label: template.code },
        ]}
        title={template.name}
        subtitle={`${template.code} · version ${template.version}`}
        status={template.status}
        badges={
          template.usageCount > 0 ? (
            <Badge tone="neutral">Used {template.usageCount}×</Badge>
          ) : null
        }
        meta={[
          { label: "Type", value: inspectionTypeLabels[template.inspectionType] },
          { label: "Checks", value: String(template.itemCount) },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {may.canEdit ? (
              <Button asChild variant="secondary">
                <Link href={`/hse/templates/${template.id}/edit`}>
                  {may.wouldVersion ? `Edit — makes v${template.version + 1}` : "Edit"}
                </Link>
              </Button>
            ) : null}
            <TemplateLifecycle template={template} />
          </div>
        }
      />

      {/* The rule the whole file turns on, said where somebody is about to
          break it (PRD #22 §349). */}
      {may.wouldVersion ? (
        <p className="rounded-md border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
          {template.usageCount} inspection{template.usageCount === 1 ? " has" : "s have"} been run
          against this version. Editing it creates version {template.version + 1} and leaves this
          one exactly as it is, so those inspections still read against what they were actually
          checked with.
        </p>
      ) : null}

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">About</h2>
        <DetailGrid
          className="mt-4"
          items={[
            { label: "Description", value: orDash(template.description) },
            { label: "Created by", value: orDash(template.createdBy?.fullName ?? null) },
            { label: "Created", value: formatDateTime(template.createdAt) },
          ]}
        />
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">Checks</h2>
        <ol className="mt-4 divide-y divide-line">
          {template.items.map((item) => (
            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
              <p className="text-table font-medium text-fg">
                {item.code ? <span className="text-fg-subtle">{item.code} · </span> : null}
                {item.label}
                {item.required ? (
                  <span className="ml-1 text-danger-strong" aria-hidden="true">
                    *
                  </span>
                ) : null}
              </p>
              {item.description ? (
                <p className="mt-1 text-meta text-fg-subtle">{item.description}</p>
              ) : null}
              <p className="mt-1.5 flex flex-wrap gap-2 text-meta text-fg-subtle">
                <span>{responseTypeLabels[item.responseType]}</span>
                {item.riskIfFailed ? (
                  <Badge
                    tone={
                      item.riskIfFailed === "CRITICAL"
                        ? "danger"
                        : item.riskIfFailed === "HIGH"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {severityLabels[item.riskIfFailed]} if failed
                  </Badge>
                ) : null}
                {item.requiresNoteOnFail ? <span>Needs a note if it fails</span> : null}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
