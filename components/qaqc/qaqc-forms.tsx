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
} from "@/lib/modules/qaqc/qaqc.status";
import { qaqcLabel } from "./qaqc-labels";
import { useQaqcTranslations } from "./qaqc-text";
import { localDay } from "@/components/hr/local-day";
import { CurrentOption } from "@/components/hse/hse-forms";
import { FormSelect } from "@/components/ui/form-select";

/**
 * The QA/QC record forms (PRD #21 §43, §66, §116, §128, §144).
 *
 * None of them carries a status or a result. Records move through named actions
 * — submit, approve, close — so there is nothing here for a dropdown to set,
 * and no way to type your way past an approval.
 */

export type Option = { value: string; label: string };

function today(): string {
  return localDay();
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
  const t = useQaqcTranslations();
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
        title={t("form.request.section")}
        description={t("form.request.sectionBody")}
      >
        <Field label={t("form.request.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("detail.type")} name="inspectionType" required>
          <FormSelect
            id="inspectionType"
            name="inspectionType"
            className={selectClass}
            value={inspectionType}
            onChange={(event) => setType(event.target.value)}
          >
            {INSPECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {qaqcLabel(t, "inspectionType", type)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("detail.priority")} name="priority" required>
          <FormSelect
            id="priority"
            name="priority"
            className={selectClass}
            defaultValue={values?.priority ?? "MEDIUM"}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {qaqcLabel(t, "priority", priority)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field
          label={t("detail.project")}
          name="projectId"
          required={inspectionType === "WORK"}
          hint={inspectionType === "WORK" ? t("form.request.workHint") : undefined}
        >
          <FormSelect
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("form.notTied")}</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
            <CurrentOption value={values?.projectId} options={projects} />
          </FormSelect>
        </Field>

        {inspectionType === "MATERIAL" ? (
          <Field
            label={t("detail.delivery")}
            name="goodsReceiptId"
            required
            hint={
              receipts.length === 0
                ? t("form.request.noDeliveries")
                : t("form.request.deliveryHint")
            }
          >
            <FormSelect
              id="goodsReceiptId"
              name="goodsReceiptId"
              className={selectClass}
              defaultValue={values?.goodsReceiptId ?? ""}
            >
              <option value="">{t("form.chooseDelivery")}</option>
              {receipts.map((receipt) => (
                <option key={receipt.value} value={receipt.value}>
                  {receipt.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : (
          <Field label={t("detail.where")} name="locationText">
            <Input
              id="locationText"
              name="locationText"
              defaultValue={values?.locationText ?? ""}
              maxLength={200}
              placeholder={t("form.request.wherePlaceholder")}
            />
          </Field>
        )}

        <Field label={t("detail.raisedOn")} name="requestedDate" required>
          <Input
            id="requestedDate"
            name="requestedDate"
            type="date"
            defaultValue={values?.requestedDate ?? today()}
            required
          />
        </Field>

        <Field label={t("detail.neededBy")} name="requiredByDate">
          <Input
            id="requiredByDate"
            name="requiredByDate"
            type="date"
            defaultValue={values?.requiredByDate ?? ""}
          />
        </Field>

        {canAssign ? (
          <Field label={t("detail.inspector")} name="assignedInspectorMemberId" className="sm:col-span-2">
            <FormSelect
              id="assignedInspectorMemberId"
              name="assignedInspectorMemberId"
              className={selectClass}
              defaultValue={values?.assignedInspectorMemberId ?? ""}
            >
              <option value="">{t("form.request.leaveUnassigned")}</option>
              {members.map((member) => (
                <option key={member.value} value={member.value}>
                  {member.label}
                </option>
              ))}
              <CurrentOption value={values?.assignedInspectorMemberId} options={members} />
            </FormSelect>
          </Field>
        ) : null}

        <Field label={t("detail.detail")} name="description" className="sm:col-span-2">
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
  const t = useQaqcTranslations();
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
        title={t("form.inspection.section")}
        description={t("form.inspection.sectionBody")}
      >
        <Field label={t("detail.type")} name="inspectionType" required>
          <FormSelect
            id="inspectionType"
            name="inspectionType"
            className={selectClass}
            value={inspectionType}
            onChange={(event) => setType(event.target.value)}
          >
            {INSPECTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {qaqcLabel(t, "inspectionType", type)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field
          label={t("detail.template")}
          name="templateId"
          hint={
            matching.length === 0
              ? t("form.inspection.noTemplate")
              : t("form.inspection.templateHint")
          }
        >
          <FormSelect
            id="templateId"
            name="templateId"
            className={selectClass}
            defaultValue={values?.templateId ?? ""}
          >
            <option value="">{t("common.noChecklist")}</option>
            {matching.map((template) => (
              <option key={template.value} value={template.value}>
                {template.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("detail.inspector")} name="assignedInspectorMemberId" required>
          <FormSelect
            id="assignedInspectorMemberId"
            name="assignedInspectorMemberId"
            className={selectClass}
            defaultValue={values?.assignedInspectorMemberId ?? ""}
            required
          >
            <option value="">{t("form.inspection.chooseInspector")}</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
            <CurrentOption value={values?.assignedInspectorMemberId} options={members} />
          </FormSelect>
        </Field>

        <Field label={t("form.inspection.inspectionDate")} name="inspectionDate">
          <Input
            id="inspectionDate"
            name="inspectionDate"
            type="date"
            defaultValue={values?.inspectionDate ?? ""}
          />
        </Field>

        <Field label={t("detail.project")} name="projectId" required={inspectionType === "WORK"}>
          <FormSelect
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("form.notTied")}</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
            <CurrentOption value={values?.projectId} options={projects} />
          </FormSelect>
        </Field>

        {inspectionType === "MATERIAL" ? (
          <Field label={t("detail.delivery")} name="goodsReceiptId" required>
            <FormSelect
              id="goodsReceiptId"
              name="goodsReceiptId"
              className={selectClass}
              defaultValue={values?.goodsReceiptId ?? ""}
            >
              <option value="">{t("form.chooseDelivery")}</option>
              {receipts.map((receipt) => (
                <option key={receipt.value} value={receipt.value}>
                  {receipt.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : (
          <Field label={t("detail.where")} name="locationText">
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
            label={t("form.inspection.againstRequest")}
            name="requestId"
            className="sm:col-span-2"
            hint={t("form.inspection.againstRequestHint")}
          >
            <FormSelect
              id="requestId"
              name="requestId"
              className={selectClass}
              defaultValue={values?.requestId ?? ""}
            >
              <option value="">{t("form.inspection.notFromRequest")}</option>
              {requests.map((request) => (
                <option key={request.value} value={request.value}>
                  {request.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : null}
      </FormSection>

      <FormSection
        title={t("form.inspection.references")}
        description={t("form.inspection.referencesBody")}
      >
        <Field label={t("detail.workReference")} name="workReference">
          <Input
            id="workReference"
            name="workReference"
            defaultValue={values?.workReference ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label={t("detail.drawing")} name="drawingReference">
          <Input
            id="drawingReference"
            name="drawingReference"
            defaultValue={values?.drawingReference ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label={t("detail.specification")} name="specificationReference" className="sm:col-span-2">
          <Input
            id="specificationReference"
            name="specificationReference"
            defaultValue={values?.specificationReference ?? ""}
            maxLength={200}
          />
        </Field>

        <Field label={t("form.inspection.summary")} name="summary" className="sm:col-span-2">
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
  const t = useQaqcTranslations();
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
        title={t("form.defect.section")}
        description={t("form.defect.sectionBody")}
      >
        <Field label={t("form.defect.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("detail.project")} name="projectId" required>
          <FormSelect
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
            required
          >
            <option value="">{t("form.chooseProject")}</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
            <CurrentOption value={values?.projectId} options={projects} />
          </FormSelect>
        </Field>

        <Field label={t("table.severity")} name="severity" required>
          <FormSelect
            id="severity"
            name="severity"
            className={selectClass}
            defaultValue={values?.severity ?? "MEDIUM"}
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {qaqcLabel(t, "severity", severity)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("detail.where")} name="locationText">
          <Input
            id="locationText"
            name="locationText"
            defaultValue={values?.locationText ?? ""}
            maxLength={200}
            placeholder={t("form.defect.wherePlaceholder")}
          />
        </Field>

        <Field label={t("detail.due")} name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>

        <Field label={t("detail.assignedTo")} name="assignedToMemberId" className="sm:col-span-2">
          <FormSelect
            id="assignedToMemberId"
            name="assignedToMemberId"
            className={selectClass}
            defaultValue={values?.assignedToMemberId ?? ""}
          >
            <option value="">{t("form.request.leaveUnassigned")}</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
            <CurrentOption value={values?.assignedToMemberId} options={members} />
          </FormSelect>
        </Field>

        <Field label={t("detail.detail")} name="description" required className="sm:col-span-2">
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
  const t = useQaqcTranslations();
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
        title={t("form.ncr.section")}
        description={t("form.ncr.sectionBody")}
      >
        <Field label={t("form.ncr.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("detail.category")} name="category" required>
          <FormSelect
            id="category"
            name="category"
            className={selectClass}
            defaultValue={values?.category ?? "WORKMANSHIP"}
          >
            {NCR_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {qaqcLabel(t, "ncrCategory", category)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field label={t("table.severity")} name="severity" required>
          <FormSelect
            id="severity"
            name="severity"
            className={selectClass}
            defaultValue={values?.severity ?? "MEDIUM"}
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {qaqcLabel(t, "severity", severity)}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field
          label={t("detail.project")}
          name="projectId"
          hint={t("form.ncr.projectHint")}
        >
          <FormSelect
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("common.companyWide")}</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
            <CurrentOption value={values?.projectId} options={projects} />
          </FormSelect>
        </Field>

        <Field label={t("detail.due")} name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>

        {receipts.length > 0 ? (
          <Field label={t("detail.delivery")} name="goodsReceiptId" className="sm:col-span-2">
            <FormSelect
              id="goodsReceiptId"
              name="goodsReceiptId"
              className={selectClass}
              defaultValue={values?.goodsReceiptId ?? ""}
            >
              <option value="">{t("form.ncr.notDelivery")}</option>
              {receipts.map((receipt) => (
                <option key={receipt.value} value={receipt.value}>
                  {receipt.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : null}

        <Field label={t("detail.detail")} name="description" required className="sm:col-span-2">
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

      <FormSection title={t("form.ncr.owner")}>
        <Field label={t("detail.assignedTo")} name="assignedToMemberId">
          <FormSelect
            id="assignedToMemberId"
            name="assignedToMemberId"
            className={selectClass}
            defaultValue={values?.assignedToMemberId ?? ""}
          >
            <option value="">{t("form.request.leaveUnassigned")}</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
            <CurrentOption value={values?.assignedToMemberId} options={members} />
          </FormSelect>
        </Field>

        <Field label={t("detail.qualityOwner")} name="ownerMemberId">
          <FormSelect
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values?.ownerMemberId ?? ""}
          >
            <option value="">{t("form.ncr.notSet")}</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
            <CurrentOption value={values?.ownerMemberId} options={members} />
          </FormSelect>
        </Field>
      </FormSection>

      <FormSection
        title={t("form.ncr.investigation")}
        description={t("form.ncr.investigationBody")}
      >
        <Field label={t("form.ncr.immediateAction")} name="immediateAction" className="sm:col-span-2">
          <Textarea
            id="immediateAction"
            name="immediateAction"
            rows={3}
            defaultValue={values?.immediateAction ?? ""}
            maxLength={4000}
            placeholder={t("form.ncr.immediatePlaceholder")}
          />
        </Field>

        <Field label={t("form.ncr.rootCause")} name="rootCause" className="sm:col-span-2">
          <Textarea
            id="rootCause"
            name="rootCause"
            rows={4}
            defaultValue={values?.rootCause ?? ""}
            maxLength={4000}
            placeholder={t("form.ncr.rootCausePlaceholder")}
          />
        </Field>

        <Field
          label={t("form.ncr.summary")}
          name="correctiveActionSummary"
          className="sm:col-span-2"
        >
          <Textarea
            id="correctiveActionSummary"
            name="correctiveActionSummary"
            rows={3}
            defaultValue={values?.correctiveActionSummary ?? ""}
            maxLength={4000}
            placeholder={t("form.ncr.summaryPlaceholder")}
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
  const t = useQaqcTranslations();
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
        title={t("form.action.section")}
        description={
          parentLabel
            ? t("form.action.raisedAgainst", { parent: parentLabel })
            : t("form.action.sectionBody")
        }
      >
        <Field label={t("form.action.title")} name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={200} />
        </Field>

        <Field label={t("detail.assignedTo")} name="assignedToMemberId" required>
          <FormSelect
            id="assignedToMemberId"
            name="assignedToMemberId"
            className={selectClass}
            defaultValue={values?.assignedToMemberId ?? ""}
            required
          >
            <option value="">{t("form.action.chooseSomebody")}</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
            <CurrentOption value={values?.assignedToMemberId} options={members} />
          </FormSelect>
        </Field>

        <Field label={t("detail.due")} name="dueDate">
          <Input id="dueDate" name="dueDate" type="date" defaultValue={values?.dueDate ?? ""} />
        </Field>

        <Field label={t("detail.project")} name="projectId" className="sm:col-span-2">
          <FormSelect
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">{t("form.action.inherit")}</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
            <CurrentOption value={values?.projectId} options={projects} />
          </FormSelect>
        </Field>

        <Field label={t("detail.detail")} name="description" required className="sm:col-span-2">
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
