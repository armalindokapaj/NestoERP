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
import { Textarea } from "@/components/ui/textarea";
import { AccessError } from "@/lib/access/guards";
import { requireModule } from "@/lib/context/current-user";
import { createReinspectionAction } from "@/lib/actions/qaqc";
import * as inspections from "@/lib/modules/qaqc/inspections/inspection.service";
import { inspectionResultLabels } from "@/lib/modules/qaqc/qaqc.status";

type Params = { params: Promise<{ inspectionId: string }> };

export const metadata: Metadata = { title: "Reinspect" };

/**
 * A fresh look at work that failed (PRD #21 §154–§158).
 *
 * The reinspection gets the same checklist, its own number and its own verdict.
 * The original keeps everything it recorded — that is the point.
 */
export default async function ReinspectPage({ params }: Params) {
  const { inspectionId } = await params;
  const context = await requireModule("qaqc");

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
          { label: "QA/QC", href: "/qaqc" },
          { label: "Inspections", href: "/qaqc/inspections" },
          { label: parent.inspectionNumber, href: `/qaqc/inspections/${parent.id}` },
          { label: "Reinspect" },
        ]}
      />

      <div>
        <h1 className="text-page font-semibold text-fg">Reinspection {sequence}</h1>
        <p className="mt-1.5 text-body text-fg-muted">
          {parent.inspectionNumber} was recorded as{" "}
          {inspectionResultLabels[parent.result].toLowerCase()}. This raises a new inspection
          against the same checklist, with its own verdict — the original is left exactly as it is.
        </p>
      </div>

      <RecordForm
        action={action}
        cancelHref={`/qaqc/inspections/${parent.id}`}
        submitLabel="Raise reinspection"
        pendingLabel="Raising…"
      >
        <FormSection
          title="Reinspection"
          description="The project, location, references and checklist all come across from the inspection being re-examined."
        >
          <Field label="Inspector" name="assignedInspectorMemberId" required>
            <select
              id="assignedInspectorMemberId"
              name="assignedInspectorMemberId"
              className={selectClass}
              defaultValue={parent.assignedInspector?.memberId ?? ""}
              required
            >
              <option value="">Choose an inspector</option>
              {options.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.user.firstName} {member.user.lastName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Inspection date" name="inspectionDate">
            <Input id="inspectionDate" name="inspectionDate" type="date" />
          </Field>

          <Field label="Why it is being re-inspected" name="summary" className="sm:col-span-2">
            <Textarea
              id="summary"
              name="summary"
              rows={3}
              maxLength={4000}
              placeholder="What has changed since the last look?"
            />
          </Field>
        </FormSection>
      </RecordForm>
    </div>
  );
}
