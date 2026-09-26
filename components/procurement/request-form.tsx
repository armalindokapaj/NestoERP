"use client";

import {
  Field,
  FormSection,
  RecordForm,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currencyOptions } from "@/lib/modules/finance/finance.currency";
import {
  CATEGORIES,
  PRIORITIES,
  categoryLabels,
  priorityLabels,
} from "@/lib/modules/procurement/procurement.status";
import { LineItemsEditor, type LineValue } from "./line-items";

export type RequestFormValues = {
  title: string;
  description: string;
  projectId: string;
  departmentId: string;
  ownerMemberId: string;
  requiredDate: string;
  priority: string;
  currency: string;
  items: LineValue[];
};

/**
 * Raise or revise a purchase request (PRD #19 §50, §51, §265).
 *
 * There is no status field: a request starts as a draft and moves through named
 * actions, so there is nothing here for a browser to lie about (PRD #19 §19).
 *
 * The line prices are labelled estimates because that is what they are. A
 * request is a need; what a thing actually costs is what a supplier quotes
 * (PRD #19 §48).
 */
export function RequestForm({
  action,
  projects,
  departments,
  members,
  values,
  versionUpdatedAt,
  cancelHref,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  projects: SelectOption[];
  departments: SelectOption[];
  members: SelectOption[];
  values?: RequestFormValues;
  versionUpdatedAt?: string;
  cancelHref: string;
  submitLabel: string;
  pendingLabel: string;
}) {
  return (
    <RecordForm
      action={action}
      module="procurement"
      cancelHref={cancelHref}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
      versionUpdatedAt={versionUpdatedAt}
    >
      <FormSection
        title="What is needed"
        description="A request is an ask, not a commitment. Nothing is owed to anybody until an order is issued."
      >
        <Field label="Title" name="title" required className="sm:col-span-2">
          <Input id="title" name="title" defaultValue={values?.title ?? ""} required maxLength={250} />
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

        <Field label="Needed by" name="requiredDate">
          <Input
            id="requiredDate"
            name="requiredDate"
            type="date"
            defaultValue={values?.requiredDate ?? ""}
          />
        </Field>

        <Field label="Notes" name="description" className="sm:col-span-2">
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={values?.description ?? ""}
            maxLength={4000}
          />
        </Field>
      </FormSection>

      <FormSection
        title="Where it belongs"
        description="A request with no project is a company-general ask — office equipment, insurance, and the like."
      >
        <Field label="Project" name="projectId">
          <select
            id="projectId"
            name="projectId"
            className={selectClass}
            defaultValue={values?.projectId ?? ""}
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.value} value={project.value}>
                {project.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Department" name="departmentId">
          <select
            id="departmentId"
            name="departmentId"
            className={selectClass}
            defaultValue={values?.departmentId ?? ""}
          >
            <option value="">Not set</option>
            {departments.map((department) => (
              <option key={department.value} value={department.value}>
                {department.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Buyer" name="ownerMemberId" hint="Who will source this">
          <select
            id="ownerMemberId"
            name="ownerMemberId"
            className={selectClass}
            defaultValue={values?.ownerMemberId ?? ""}
          >
            <option value="">Not assigned</option>
            {members.map((member) => (
              <option key={member.value} value={member.value}>
                {member.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Currency" name="currency" hint="For the estimates below">
          <select
            id="currency"
            name="currency"
            className={selectClass}
            defaultValue={values?.currency ?? "EUR"}
          >
            <option value="">Not set</option>
            {currencyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Lines"
        description="What is being asked for, and roughly what it is expected to cost. A line with no estimate contributes nothing to the total rather than zero."
      >
        <div className="sm:col-span-2">
          <LineItemsEditor
            initial={values?.items}
            columns={["quantity", "unit", "estimatedUnitPrice", "category"]}
            categories={CATEGORIES.map((category) => ({
              value: category,
              label: categoryLabels[category],
            }))}
            priceLabel="Estimated unit price"
            priceField="estimatedUnitPrice"
          />
        </div>
      </FormSection>
    </RecordForm>
  );
}
