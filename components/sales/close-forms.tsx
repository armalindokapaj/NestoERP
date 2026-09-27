"use client";

import * as React from "react";
import { localToday } from "@/components/finance/local-date";

import {
  Field,
  FormSection,
  selectClass,
  type FormActionResult,
  type SelectOption,
} from "@/components/forms/record-form";
import { useSalesTranslations } from "@/components/sales/sales-text";
import { salesLabel } from "@/lib/i18n/modules/sales/labels";
import { WorkflowForm } from "@/components/sales/workflow-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LOST_REASONS } from "@/lib/modules/sales/opportunities/opportunity.schema";
import { lostReasonLabels } from "@/lib/modules/sales/proposals/proposal.status";

/**
 * Closing a deal (PRD #17 §86, §93, §253).
 *
 * Both outcomes are full pages rather than dialogs, because both ask real
 * questions: winning decides which canonical client the company now has and
 * whether a project is created; losing records why, which is the only reason
 * the lost-reason report exists (PRD #17 §168).
 *
 * Neither is applied optimistically. The client and project are created by the
 * server, in one transaction, and the page waits for it (PRD #17 §253).
 *
 * Both are workflow steps, so leaving with input offers no "Save and continue"
 * (AUD-03 §4): see WorkflowForm.
 */

export function WonForm({
  action,
  hasClient,
  clientName,
  clients,
  projects,
  canLinkClient,
  canCreateClient,
  canLinkProject,
  canCreateProject,
  defaultValue,
  currency,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  hasClient: boolean;
  clientName: string | null;
  clients: SelectOption[];
  projects: SelectOption[];
  /**
   * Linking and creating are separate answers because they are separate
   * permissions: a sales user may hand a deal to an existing project without
   * being able to create one (PRD #17 §396, §397). Offering an option the
   * server will refuse is the shell advertising what somebody cannot do
   * (PRD #7 §13).
   */
  canLinkClient: boolean;
  canCreateClient: boolean;
  canLinkProject: boolean;
  canCreateProject: boolean;
  defaultValue: string;
  currency: string;
  cancelHref: string;
}) {
  const t = useSalesTranslations();
  const [clientMode, setClientMode] = React.useState(hasClient ? "KEEP" : "EXISTING");
  const [projectMode, setProjectMode] = React.useState("NONE");
  const today = localToday();

  return (
    <WorkflowForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={t("forms.markWon")}
      pendingLabel={t("forms.closing")}
      workflow={t("forms.markWon")}
    >
      <FormSection title={t("forms.closeTitle")} description={t("forms.wonCloseDescription")}>
        <Field label={t("forms.actualCloseDate")} name="actualCloseDate" required>
          <Input id="actualCloseDate" name="actualCloseDate" type="date" defaultValue={today} required />
        </Field>

        <Field label={t("forms.finalValue", { currency })} name="finalValue" required>
          <Input
            id="finalValue"
            name="finalValue"
            inputMode="decimal"
            defaultValue={defaultValue}
            required
          />
        </Field>

        <Field label={t("forms.wonReason")} name="wonReason" className="sm:col-span-2">
          <Textarea id="wonReason" name="wonReason" rows={3} maxLength={1000} />
        </Field>
      </FormSection>

      <FormSection
        title={t("forms.clientTitle")}
        description={t("forms.wonClientDescription")}
      >
        <Field label={t("forms.clientTitle")} name="clientMode" required className="sm:col-span-2">
          <select
            id="clientMode"
            name="clientMode"
            className={selectClass}
            value={clientMode}
            onChange={(event) => setClientMode(event.target.value)}
          >
            {hasClient ? <option value="KEEP">{t("forms.keepClient", { name: clientName ?? "" })}</option> : null}
            {canLinkClient ? <option value="EXISTING">{t("forms.linkExistingClient")}</option> : null}
            {canCreateClient ? <option value="NEW">{t("forms.createNewClient")}</option> : null}
          </select>
        </Field>

        {clientMode === "EXISTING" ? (
          <Field label={t("forms.existingClient")} name="clientId" required className="sm:col-span-2">
            <select id="clientId" name="clientId" className={selectClass} defaultValue="">
              <option value="">{t("forms.chooseClient")}</option>
              {clients.map((client) => (
                <option key={client.value} value={client.value}>
                  {client.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {clientMode === "NEW" ? (
          <Field label={t("forms.newClientName")} name="newClientName" required className="sm:col-span-2">
            <Input id="newClientName" name="newClientName" maxLength={200} />
          </Field>
        ) : null}
      </FormSection>

      {canLinkProject || canCreateProject ? (
        <FormSection
          title={t("forms.deliveryTitle")}
          description={t("forms.deliveryDescription")}
        >
          <Field label={t("forms.project")} name="projectMode" className="sm:col-span-2">
            <select
              id="projectMode"
              name="projectMode"
              className={selectClass}
              value={projectMode}
              onChange={(event) => setProjectMode(event.target.value)}
            >
              <option value="NONE">{t("forms.noProject")}</option>
              {canLinkProject ? <option value="EXISTING">{t("forms.linkExistingProject")}</option> : null}
              {canCreateProject ? <option value="NEW">{t("forms.createNewProject")}</option> : null}
            </select>
          </Field>

          {projectMode === "EXISTING" ? (
            <Field
              label={t("forms.existingProject")}
              name="projectId"
              required
              className="sm:col-span-2"
              hint={t("forms.sameClientHint")}
            >
              <select id="projectId" name="projectId" className={selectClass} defaultValue="">
                <option value="">{t("forms.chooseProject")}</option>
                {projects.map((project) => (
                  <option key={project.value} value={project.value}>
                    {project.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {projectMode === "NEW" ? (
            <>
              <Field label={t("forms.projectCode")} name="newProjectCode" required>
                <Input id="newProjectCode" name="newProjectCode" maxLength={30} />
              </Field>
              <Field label={t("forms.projectName")} name="newProjectName" required>
                <Input id="newProjectName" name="newProjectName" maxLength={200} />
              </Field>
            </>
          ) : null}
        </FormSection>
      ) : null}
    </WorkflowForm>
  );
}

export function LostForm({
  action,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  cancelHref: string;
}) {
  const t = useSalesTranslations();
  const [reason, setReason] = React.useState<string>("PRICE");
  const today = localToday();

  return (
    <WorkflowForm
      action={action}
      cancelHref={cancelHref}
      submitLabel={t("forms.markLost")}
      pendingLabel={t("forms.closing")}
      workflow={t("forms.markLost")}
    >
      <FormSection
        title={t("forms.closeTitle")}
        description={t("forms.lostCloseDescription")}
      >
        <Field label={t("forms.actualCloseDate")} name="actualCloseDate" required>
          <Input id="actualCloseDate" name="actualCloseDate" type="date" defaultValue={today} required />
        </Field>

        <Field label={t("forms.reason")} name="lostReason" required>
          <select
            id="lostReason"
            name="lostReason"
            className={selectClass}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {LOST_REASONS.map((option) => (
              <option key={option} value={option}>
                {salesLabel(t, "lostReason", option, lostReasonLabels[option])}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t("forms.note")}
          name="lostNote"
          className="sm:col-span-2"
          required={reason === "OTHER"}
          hint={reason === "OTHER" ? t("forms.noteRequired") : t("forms.optional")}
        >
          <Textarea id="lostNote" name="lostNote" rows={4} maxLength={2000} />
        </Field>
      </FormSection>
    </WorkflowForm>
  );
}
