import type { Metadata } from "next";
import Link from "@/components/navigation/nav-link";
import { notFound } from "next/navigation";

import { TemplateLifecycle } from "@/components/hse/template-actions";
import { DetailGrid, RecordHeader } from "@/components/modules/record-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonLink } from "@/components/people/person-link";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import * as templates from "@/lib/modules/hse/templates/template.service";
import {
  inspectionTypeLabels,
  responseTypeLabels,
  severityLabels,
} from "@/lib/modules/hse/hse.status";
import { hseLabel } from "@/lib/i18n/modules/hse/labels";
import { formatDateTime, orDash } from "@/lib/utils/format";
import { getTranslations } from "@/lib/i18n/server";

type Params = { params: Promise<{ templateId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { templateId } = await params;
  try {
    const context = await requireModule("hse");
    const template = await templates.getTemplate(context, templateId);
    return { title: template.code };
  } catch {
    return { title: (await getTranslations("hse"))("record.checklist") };
  }
}

/** One safety checklist (PRD #22 §43, §45, §349). */
export default async function TemplatePage({ params }: Params) {
  const { templateId } = await params;
  const context = await requireModule("hse");
  const t = await getTranslations("hse");

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
          { label: t("pages.templates.title"), href: "/hse/templates" },
          { label: template.code },
        ]}
        title={template.name}
        subtitle={t("risk.detail.version", { number: template.code, version: template.version })}
        status={template.status}
        badges={
          template.usageCount > 0 ? (
            <Badge tone="neutral">{t("template.detail.used", { count: template.usageCount })}</Badge>
          ) : null
        }
        meta={[
          { label: t("record.type"), value: hseLabel(t, "inspectionType", template.inspectionType, inspectionTypeLabels[template.inspectionType]) },
          { label: t("template.detail.checks"), value: String(template.itemCount) },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {may.canEdit ? (
              <Button asChild variant="secondary">
                <Link href={`/hse/templates/${template.id}/edit`}>
                  {may.wouldVersion ? t("template.detail.editMakes", { version: template.version + 1 }) : t("template.detail.edit")}
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
          {t("template.detail.wouldVersion", { count: template.usageCount, version: template.version + 1 })}
        </p>
      ) : null}

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{t("risk.detail.about")}</h2>
        <DetailGrid
          className="mt-4"
          items={[
            { label: t("record.description"), value: orDash(template.description) },
            {
              label: t("record.createdBy"),
              value: template.createdBy ? (
                <PersonLink memberId={template.createdBy.memberId} name={template.createdBy.fullName} />
              ) : (
                "—"
              ),
            },
            { label: t("record.created"), value: formatDateTime(template.createdAt) },
          ]}
        />
      </section>

      <section className="nesto-card p-5">
        <h2 className="text-card font-semibold text-fg">{t("template.detail.checks")}</h2>
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
                <span>{hseLabel(t, "responseType", item.responseType, responseTypeLabels[item.responseType])}</span>
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
                    {t("template.detail.ifFailed", { severity: hseLabel(t, "severity", item.riskIfFailed, severityLabels[item.riskIfFailed]) })}
                  </Badge>
                ) : null}
                {item.requiresNoteOnFail ? <span>{t("template.detail.needsNote")}</span> : null}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
