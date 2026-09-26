"use client";

import * as React from "react";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  INSPECTION_TYPES,
  NCR_CATEGORIES,
  PRIORITIES,
  SEVERITIES,
  inspectionTypeLabels,
  ncrCategoryLabels,
  priorityLabels,
  severityLabels,
} from "@/lib/modules/qaqc/qaqc.status";

/**
 * The QA/QC record forms (PRD #21 §43, §66, §116, §128, §144).
 *
 * None of them carries a status or a result. Records move through named actions
 * — submit, approve, close — so there is nothing here for a dropdown to set,
 * and no way to type your way past an approval.
 */

export type Option = { value: string; label: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Inspection request                                                          */
/* -------------------------------------------------------------------------- */

export type RequestFormValues = {
  title: string;
  inspectionType: string;
  projectId: string;
  goodsReceiptId: string;
  requestedDate: string;
  requiredByDate: string;
  priority: string;
  assignedInspectorMemberId: string;
  description: string;
  locationText: string;
};

export function RequestForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  receipts,
  canAssign,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: RequestFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  receipts: Option[];
  canAssign: boolean;
}) {
  const [inspectionType, setType] = React.useState(values?.inspectionType ?? "WORK");

  return (
    <RecordForm
      module="qaqc"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Request"
        description="Asking for an inspection is not the inspection. Somebody from quality picks this up and carries it out."
      >
        <Field label="What needs inspecting" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Type" name="inspectionType" required>
          <select
            id="inspectionType"
            name="inspectionType"
            className={selectClass}
            value={inspectionType}
            onChange={(event) => setType(event.target.value)}
          >
            {INSPECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {inspectionTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Priority" name="priority" required>
          <select
            id="priority"
            name="priority"
            className={selectClass}
            defaultValue={values?.priority ?? "MEDIUM"}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabels[priority]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Project"
          name="projectId"
          required={inspectionType === "WORK"}
          hint={inspectionType === "WORK" ? "Work happens on a site." : undefined}
        >
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">Not tied to a project</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        {inspectionType === "MATERIAL" ? (
          <Field
            label="Delivery"
            name="goodsReceiptId"
            required
            hint={
              receipts.length === 0
                ? "No deliveries are visible to you, so a material request cannot be raised."
                : "Material quality is always about a specific delivery."
            }
          >
            <select
              id="goodsReceiptId"
              name="goodsReceiptId"
              className={selectClass}
              defaultValue={values?.goodsReceiptId ?? ""}
            >
              <option value="">Choose a delivery</option>
              {receipts.map((receipt) => (
                <option key={receipt.value} value={receipt.value}>
                  {receipt.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Where" name="locationText">
            <Input
              id="locationText"
              name="locationText"
              defaultValue={values?.locationText ?? ""}
              maxLength={200}
              placeholder="Grid reference, level, unit…"
            />
          </Field>
        )}

        <Field label="Raised on" name="requestedDate" required>
          <Input
            id="requestedDate"
            name="requestedDate"
            type="date"
            defaultValue={values?.requestedDate ?? today()}
            required
          />
        </Field>

        <Field label="Needed by" name="requiredByDate">
          <Input
            id="requiredByDate"
            name="requiredByDate"
            type="date"
            defaultValue={values?.requiredByDate ?? ""}
          />
        </Field>

        {canAssign ? (
          <Field label="Inspector" name="assignedInspectorMemberId" className="sm:col-span-2">
            <select
              id="assignedInspectorMemberId"
              name="assignedInspectorMemberId"
              className={selectClass}
              defaultValue={values?.assignedInspectorMemberId ?? ""}
            >
              <option value="">Leave unassigned</option>
              {members.map((member) => (
                <option key={member.value} value={member.value}>
                  {member.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Detail" name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={values?.description ?? ""}
            maxLength={4000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* Inspection                                                                  */
/* -------------------------------------------------------------------------- */

export type InspectionFormValues = {
  inspectionType: string;
  requestId: string;
  templateId: string;
  projectId: string;
  goodsReceiptId: string;
  assignedInspectorMemberId: string;
  inspectionDate: string;
  locationText: string;
  workReference: string;
  drawingReference: string;
  specificationReference: string;
  summary: string;
};

export function InspectionForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  templates,
  receipts,
  requests,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: InspectionFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  templates: { value: string; label: string; inspectionType: string }[];
  receipts: Option[];
  requests: Option[];
}) {
  const [inspectionType, setType] = React.useState(values?.inspectionType ?? "WORK");
  const matching = templates.filter((row) => row.inspectionType === inspectionType);

  return (
    <RecordForm
      module="qaqc"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Inspection"
        description="The checklist is copied onto the inspection when it is created, so editing the template afterwards never changes what was actually checked."
      >
        <Field label="Type" name="inspectionType" required>
          <select
            id="inspectionType"
            name="inspectionType"
            className={selectClass}
            value={inspectionType}
            onChange={(event) => setType(event.target.value)}
          >
            {INSPECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {inspectionTypeLabels[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Template"
          name="templateId"
          hint={
            matching.length === 0
              ? "No active template for this type. The inspection can still run without a checklist."
              : "Its checks are copied onto this inspection."
          }
        >
          <select
            id="templateId"
            name="templateId"
            className={selectClass}
            defaultValue={values?.templateId ?? ""}
          >
            <option value="">No checklist</option>
            {matching.map((template) => (
              <option key={template.value} value={template.value}>
                {template.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Inspector" name="assignedInspectorMemberId" required>
          <select
            id="assignedInspectorMemberId"
            name="assignedInspectorMemberId"
            className={selectClass}
            defaultValue={values?.assignedInspectorMemberId ?? ""}
            required
          >
            <option value="">Choose an inspector</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Inspection date" name="inspectionDate">
          <Input
            id="inspectionDate"
            name="inspectionDate"
            type="date"
            defaultValue={values?.inspectionDate ?? ""}
          />
        </Field>

        <Field label="Project" name="projectId" required={inspectionType === "WORK"}>
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">Not tied to a project</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        {inspectionType === "MATERIAL" ? (
          <Field label="Delivery" name="goodsReceiptId" required>
            <select
              id="goodsReceiptId"
              name="goodsReceiptId"
              className={selectClass}
              defaultValue={values?.goodsReceiptId ?? ""}
            >
              <option value="">Choose a delivery</option>
              {receipts.map((receipt) => (
                <option key={receipt.value} value={receipt.value}>
                  {receipt.label}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Where" name="locationText">
            <Input
              id="locationText"
              name="locationText"
              defaultValue={values?.locationText ?? ""}
              maxLength={200}
            />
          </Field>
        )}

        {requests.length > 0 ? (
          <Field
            label="Against request"
            name="requestId"
            className="sm:col-span-2"
            hint="Links the inspection back to whoever asked for it."
          >
            <select
              id="requestId"
              name="requestId"
              className={selectClass}
              defaultValue={values?.requestId ?? ""}
            >
              <option value="">Not from a request</option>
              {requests.map((request) => (
                <option key={request.value} value={request.value}>
                  {request.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </FormSection>

      <FormSection
        title="References"
        description="What the work is being checked against, so the inspection can be read back years later."
      >
        <Field label="Work reference" name="workReference">
          <Input
            id="workReference"
            name="workReference"
            defaultValue={values?.workReference ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label="Drawing" name="drawingReference">
          <Input
            id="drawingReference"
            name="drawingReference"
            defaultValue={values?.drawingReference ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label="Specification" name="specificationReference" className="sm:col-span-2">
          <Input
            id="specificationReference"
            name="specificationReference"
            defaultValue={values?.specificationReference ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label="Summary" name="summary" className="sm:col-span-2">
          <Textarea
            id="summary"
            name="summary"
            rows={3}
            defaultValue={values?.summary ?? ""}
            maxLength={4000}
          />
        </Field>
      </FormSection>
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* Defect                                                                      */
/* -------------------------------------------------------------------------- */

export type DefectFormValues = {
  title: string;
  description: string;
  projectId: string;
  inspectionId: string;
  severity: string;
  locationText: string;
  assignedToMemberId: string;
  dueDate: string;
};

export function DefectForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: DefectFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
}) {
  return (
    <RecordForm
      module="qaqc"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Defect"
        description="Something on a job that needs putting right. If it also needs a root cause and a formal response, raise an NCR from it afterwards."
      >
        <Field label="What is wrong" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Project" name="projectId" required>
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
            required
          >
            <option value="">Choose a project</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Severity" name="severity" required>
          <select
            id="severity"
            name="severity"
            className={selectClass}
            defaultValue={values?.severity ?? "MEDIUM"}
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severityLabels[severity]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Where" name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
            placeholder="Level, grid, unit…"
          />
        </Field>

        <Field label="Due" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>

        <Field label="Assigned to" name="assignedToMemberId" className="sm:col-span-2">
          <select
            id="assignedToMemberId"
            name="assignedToMemberId"
            className={selectClass}
            defaultValue={values?.assignedToMemberId ?? ""}
          >
            <option value="">Leave unassigned</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Detail" name="description" required className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={5}
            defaultValue={values?.description ?? ""}
            required
            maxLength={4000}
          />
        </Field>
      </FormSection>

      <input type="hidden" name="inspectionId" value={values?.inspectionId ?? ""} />
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* NCR                                                                         */
/* -------------------------------------------------------------------------- */

export type NcrFormValues = {
  title: string;
  description: string;
  projectId: string;
  inspectionId: string;
  goodsReceiptId: string;
  sourceDefectId: string;
  category: string;
  severity: string;
  assignedToMemberId: string;
  ownerMemberId: string;
  immediateAction: string;
  rootCause: string;
  correctiveActionSummary: string;
  dueDate: string;
};

export function NcrForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  receipts,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: NcrFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  receipts: Option[];
}) {
  return (
    <RecordForm
      module="qaqc"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Non-conformance"
        description="A formal statement that a requirement was not met. It cannot be closed until the root cause is recorded and a corrective action has been verified."
      >
        <Field label="What did not meet requirement" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Category" name="category" required>
          <select
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "WORKMANSHIP"}
          >
            {NCR_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {ncrCategoryLabels[category]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Severity" name="severity" required>
          <select
            id="severity"
            name="severity"
            className={selectClass}
            defaultValue={values?.severity ?? "MEDIUM"}
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severityLabels[severity]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Project"
          name="projectId"
          hint="A supplier or material non-conformance may have no project."
        >
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">Company-wide</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>

        {receipts.length > 0 ? (
          <Field label="Delivery" name="goodsReceiptId" className="sm:col-span-2">
            <select
              id="goodsReceiptId"
              name="goodsReceiptId"
              className={selectClass}
              defaultValue={values?.goodsReceiptId ?? ""}
            >
              <option value="">Not about a delivery</option>
              {receipts.map((receipt) => (
                <option key={receipt.value} value={receipt.value}>
                  {receipt.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="Detail" name="description" required className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={5}
            defaultValue={values?.description ?? ""}
            required
            maxLength={4000}
          />
        </Field>
      </FormSection>

      <FormSection title="Who owns it">
        <Field label="Assigned to" name="assignedToMemberId">
          <select
            id="assignedToMemberId"
            name="assignedToMemberId"
            className={selectClass}
            defaultValue={values?.assignedToMemberId ?? ""}
          >
            <option value="">Leave unassigned</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Quality owner" name="ownerMemberId">
          <select
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values?.ownerMemberId ?? ""}
          >
            <option value="">Not set</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Investigation"
        description="The root cause is what lets this close. Without it the NCR records that a problem stopped being discussed rather than that it was solved."
      >
        <Field label="Immediate action" name="immediateAction" className="sm:col-span-2">
          <Textarea
            id="immediateAction"
            name="immediateAction"
            rows={3}
            defaultValue={values?.immediateAction ?? ""}
            maxLength={4000}
            placeholder="What was done straight away to contain it?"
          />
        </Field>

        <Field label="Root cause" name="rootCause" className="sm:col-span-2">
          <Textarea
            id="rootCause"
            name="rootCause"
            rows={4}
            defaultValue={values?.rootCause ?? ""}
            maxLength={4000}
            placeholder="Why did it happen?"
          />
        </Field>

        <Field
          label="Corrective action summary"
          name="correctiveActionSummary"
          className="sm:col-span-2"
        >
          <Textarea
            id="correctiveActionSummary"
            name="correctiveActionSummary"
            rows={3}
            defaultValue={values?.correctiveActionSummary ?? ""}
            maxLength={4000}
            placeholder="What will stop it happening again?"
          />
        </Field>
      </FormSection>

      <input type="hidden" name="inspectionId" value={values?.inspectionId ?? ""} />
      <input type="hidden" name="sourceDefectId" value={values?.sourceDefectId ?? ""} />
    </RecordForm>
  );
}

/* -------------------------------------------------------------------------- */
/* Corrective action                                                           */
/* -------------------------------------------------------------------------- */

export type ActionFormValues = {
  title: string;
  description: string;
  ncrId: string;
  defectId: string;
  inspectionId: string;
  projectId: string;
  assignedToMemberId: string;
  dueDate: string;
};

export function CorrectiveActionForm({
  action,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
  projects,
  members,
  parentLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  values?: ActionFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
  projects: Option[];
  members: Option[];
  parentLabel: string | null;
}) {
  return (
    <RecordForm
      module="qaqc"
      action={action}
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="Corrective action"
        description={
          parentLabel
            ? `Raised against ${parentLabel}. Whoever does it records what they did, and somebody else verifies it.`
            : "Whoever does it records what they did, and somebody else verifies it."
        }
      >
        <Field label="What needs doing" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label="Assigned to" name="assignedToMemberId" required>
          <select
            id="assignedToMemberId"
            name="assignedToMemberId"
            className={selectClass}
            defaultValue={values?.assignedToMemberId ?? ""}
            required
          >
            <option value="">Choose somebody</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Due" name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>

        <Field label="Project" name="projectId" className="sm:col-span-2">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">Inherit from what it was raised against</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Detail" name="description" required className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={5}
            defaultValue={values?.description ?? ""}
            required
            maxLength={4000}
          />
        </Field>
      </FormSection>

      <input type="hidden" name="ncrId" value={values?.ncrId ?? ""} />
      <input type="hidden" name="defectId" value={values?.defectId ?? ""} />
      <input type="hidden" name="inspectionId" value={values?.inspectionId ?? ""} />
    </RecordForm>
  );
}
