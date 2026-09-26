import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
} from "@/components/forms/record-form";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Input } from "@/components/ui/input";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { escalateDefectAction } from "@/lib/actions/qaqc";
import * as defects from "@/lib/modules/qaqc/defects/defect.service";
import { NCR_CATEGORIES, ncrCategoryLabels } from "@/lib/modules/qaqc/qaqc.status";

type Params = { params: Promise<{ defectId: string }> };

export const metadata: Metadata = { title: "Raise an NCR" };

/**
 * Turning a defect into a formal non-conformance (PRD #21 §170, §172).
 *
 * The defect stays exactly where it is: the site still has to fix the thing
 * whatever the paperwork says. The NCR asks the separate question of *why it
 * happened*, and cannot close until somebody answers it.
 */
export default async function EscalateDefectPage({ params }: Params) {
  const { defectId } = await params;
  const context = await requireModule("qaqc");

  let defect;
  try {
    defect = await defects.getDefect(context, defectId);
  } catch (error) {
    if (error instanceof AccessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!defect.capabilities.canEscalate) notFound();

  async function action(formData: FormData) {
    "use server";
    return escalateDefectAction(defectId, formData);
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs
        items={[
          { label: "QA/QC", href: "/qaqc" },
          { label: "Defects", href: "/qaqc/defects" },
          { label: defect.defectNumber, href: `/qaqc/defects/${defect.id}` },
          { label: "Raise an NCR" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Raise an NCR</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {defect.defectNumber} stays open and still has to be fixed. The NCR asks the separate
          question of why it happened, and cannot close until that is answered and a corrective
          action has been verified.
        </p>
      </div>

      <RecordForm
        module="qaqc"
        action={action}
        cancelHref={`/qaqc/defects/${defect.id}`}
        submitLabel="Raise NCR"
        pendingLabel="Raising…"
      >
        <FormSection
          title="Non-conformance"
          description="The description, project, severity and assignee come across from the defect."
        >
          <Field label="Title" name="title" className="sm:col-span-2">
            <Input
              id="title"
              name="title"
              defaultValue={defect.title}
              maxLength={200}
            />
          </Field>

          <Field
            label="Category"
            name="category"
            required
            className="sm:col-span-2"
            hint="What kind of failure this was — it is how quality trends are read later."
          >
            <select
              id="category"
              name="category"
              className={selectClass}
              defaultValue="WORKMANSHIP"
              required
            >
              {NCR_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {ncrCategoryLabels[category]}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>
      </RecordForm>
    </div>
  );
}
