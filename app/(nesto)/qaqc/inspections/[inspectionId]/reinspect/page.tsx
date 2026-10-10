import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
} from "@/components/forms/record-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { createReinspectionAction } from "@/lib/actions/qaqc";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import { qaqcLabel } from "@/components/qaqc/qaqc-labels";
import { FormSelect } from "@/components/ui/form-select";

type Params = { params: Promise<{ inspectionId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("qaqc");
  return { title: t("meta.reinspect") };
}

/**
 * A fresh look at work that failed (PRD #21 §154–§158).
 *
 * The reinspection gets the same checklist, its own number and its own verdict.
 * The original keeps everything it recorded — that is the point.
 */
export default async function ReinspectPage({ params }: Params) {
  const { inspectionId } = await params;
  const context = await requireModule("qaqc");
  const t = await getTranslations("qaqc");

  let parent;
  try {
    parent = await inspections.getInspection(context, inspectionId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!parent.capabilities.canRaiseReinspection) notFound();

  const options = await inspections.inspectionFormOptions(context);
  const sequence = parent.reinspections.length + 1;

  async function action(formData: FormData) {
    "use server";
    return createReinspectionAction(inspectionId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: t("common.qaqc"), href: "/qaqc" },
          { label: t("crumbs.inspections"), href: "/qaqc/inspections" },
          { label: parent.inspectionNumber, href: `/qaqc/inspections/${parent.id}` },
          { label: t("crumbs.reinspect") },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">{t("common.reinspectionN", { n: sequence })}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {t("inspectionPage.reinspectIntro", {
            number: parent.inspectionNumber,
            result: qaqcLabel(t, "inspectionResultLower", parent.result),
          })}
        </p>
      </div>

      <RecordForm
        module="qaqc"
        action={action}
        cancelHref={`/qaqc/inspections/${parent.id}`}
        submitLabel={t("inspectionPage.raiseReinspection")}
        pendingLabel={t("common.raising")}
      >
        <FormSection
          title={t("inspectionPage.reinspection")}
          description={t("inspectionPage.reinspectionBody")}
        >
          <Field label={t("detail.inspector")} name="assignedInspectorMemberId" required>
            <FormSelect
              id="assignedInspectorMemberId"
              name="assignedInspectorMemberId"
              className={selectClass}
              defaultValue={parent.assignedInspector?.memberId ?? ""}
              required
            >
              <option value="">{t("form.inspection.chooseInspector")}</option>
              {options.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.user.firstName} {member.user.lastName}
                </option>
              ))}
            </FormSelect>
          </Field>

          <Field label={t("form.inspection.inspectionDate")} name="inspectionDate">
            <Input id="inspectionDate" name="inspectionDate" type="date" />
          </Field>

          <Field label={t("inspectionPage.why")} name="summary" className="sm:col-span-2">
            <Textarea
              id="summary"
              name="summary"
              rows={3}
              maxLength={4000}
              placeholder={t("inspectionPage.whyPlaceholder")}
            />
          </Field>
        </FormSection>
      </RecordForm>
    </div>
  );
}
