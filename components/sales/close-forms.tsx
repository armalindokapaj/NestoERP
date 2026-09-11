"use client";

import * as React from "react";

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
  const [clientMode, setClientMode] = React.useState(hasClient ? "KEEP" : "EXISTING");
  const [projectMode, setProjectMode] = React.useState("NONE");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel="Mark won"
      pendingLabel="Closing…"
    >
      <FormSection title="The close" description="What the deal was worth when it was agreed.">
        <Field label="Actual close date" name="actualCloseDate" required>
          <Input id="actualCloseDate" name="actualCloseDate" type="date" defaultValue={today} required />
        </Field>

        <Field label={`Final value (${currency})`} name="finalValue" required>
          <Input
            id="finalValue"
            name="finalValue"
            inputMode="decimal"
            defaultValue={defaultValue}
            required
          />
        </Field>

        <Field label="Why it was won" name="wonReason" className="sm:col-span-2">
          <Textarea id="wonReason" name="wonReason" rows={3} maxLength={1000} />
        </Field>
      </FormSection>

      <FormSection
        title="Client"
        description="A won deal is a customer relationship, so it needs a canonical client."
      >
        <Field label="Client" name="clientMode" required className="sm:col-span-2">
          <select
            id="clientMode"
            name="clientMode"
            className={selectClass}
            value={clientMode}
            onChange={(event) => setClientMode(event.target.value)}
          >
            {hasClient ? <option value="KEEP">Keep {clientName}</option> : null}
            {canLinkClient ? <option value="EXISTING">Link an existing client</option> : null}
            {canCreateClient ? <option value="NEW">Create a new client</option> : null}
          </select>
        </Field>

        {clientMode === "EXISTING" ? (
          <Field label="Existing client" name="clientId" required className="sm:col-span-2">
            <select id="clientId" name="clientId" className={selectClass} defaultValue="">
              <option value="">Choose a client</option>
              {clients.map((client) => (
                <option key={client.value} value={client.value}>
                  {client.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {clientMode === "NEW" ? (
          <Field label="New client name" name="newClientName" required className="sm:col-span-2">
            <Input id="newClientName" name="newClientName" maxLength={200} />
          </Field>
        ) : null}
      </FormSection>

      {canLinkProject || canCreateProject ? (
        <FormSection
          title="Delivery"
          description="Optional. A project can be linked later without reopening the deal."
        >
          <Field label="Project" name="projectMode" className="sm:col-span-2">
            <select
              id="projectMode"
              name="projectMode"
              className={selectClass}
              value={projectMode}
              onChange={(event) => setProjectMode(event.target.value)}
            >
              <option value="NONE">Do not create a project</option>
              {canLinkProject ? <option value="EXISTING">Link an existing project</option> : null}
              {canCreateProject ? <option value="NEW">Create a new project</option> : null}
            </select>
          </Field>

          {projectMode === "EXISTING" ? (
            <Field
              label="Existing project"
              name="projectId"
              required
              className="sm:col-span-2"
              hint="It must belong to the same client."
            >
              <select id="projectId" name="projectId" className={selectClass} defaultValue="">
                <option value="">Choose a project</option>
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
              <Field label="Project code" name="newProjectCode" required>
                <Input id="newProjectCode" name="newProjectCode" maxLength={30} />
              </Field>
              <Field label="Project name" name="newProjectName" required>
                <Input id="newProjectName" name="newProjectName" maxLength={200} />
              </Field>
            </>
          ) : null}
        </FormSection>
      ) : null}
    </RecordForm>
  );
}

export function LostForm({
  action,
  cancelHref,
}: {
  action: (formData: FormData) => Promise<FormActionResult>;
  cancelHref: string;
}) {
  const [reason, setReason] = React.useState<string>("PRICE");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <RecordForm
      action={action}
      cancelHref={cancelHref}
      submitLabel="Mark lost"
      pendingLabel="Closing…"
    >
      <FormSection
        title="The close"
        description="Recorded so the lost-reason report can say something useful."
      >
        <Field label="Actual close date" name="actualCloseDate" required>
          <Input id="actualCloseDate" name="actualCloseDate" type="date" defaultValue={today} required />
        </Field>

        <Field label="Reason" name="lostReason" required>
          <select
            id="lostReason"
            name="lostReason"
            className={selectClass}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            {LOST_REASONS.map((option) => (
              <option key={option} value={option}>
                {lostReasonLabels[option]}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Note"
          name="lostNote"
          className="sm:col-span-2"
          required={reason === "OTHER"}
          hint={reason === "OTHER" ? "Required when the reason is Other." : "Optional."}
        >
          <Textarea id="lostNote" name="lostNote" rows={4} maxLength={2000} />
        </Field>
      </FormSection>
    </RecordForm>
  );
}
