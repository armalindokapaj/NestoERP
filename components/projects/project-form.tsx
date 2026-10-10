"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import type { ActionResult } from "@/lib/actions/projects";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Create / edit project form (PRD #10 §31, §32, §41).
 *
 * Grouped into sections rather than one long list of inputs. Validation runs
 * again on the server, which is the authority — this copy exists so the person
 * filling the form finds out sooner (PRD #7 §43).
 *
 * Navigating away with unsaved changes is intercepted (PRD #10 §151).
 */
export type ProjectFormValues = {
  code: string;
  name: string;
  description: string;
  clientId: string;
  projectManagerMemberId: string;
  status: string;
  priority: string;
  projectTypeId: string;
  coverImageDocumentId: string;
  startDate: string;
  endDate: string;
  address: string;
  city: string;
  country: string;
  builtArea: string;
  isKeyProject: "YES" | "NO";
};

const STATUS_KEYS = ["PENDING", "ACTIVE", "FINISHED", "ARCHIVED"] as const;

export type SelectOption = { value: string; label: string };

function Field({
  label,
  name,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string[];
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required ? <span className="ml-0.5 text-danger-strong">*</span> : null}
      </Label>
      {children}
      {hint && !error ? <p className="text-meta text-fg-subtle">{hint}</p> : null}
      {error ? (
        <p id={`${name}-error`} className="text-meta text-danger-strong">
          {error[0]}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="nesto-card p-5">
      <h2 className="text-card font-semibold text-fg">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

export function ProjectForm({
  mode,
  initial,
  clients,
  managers,
  statuses,
  projectTypes,
  company,
  covers,
  cancelHref,
  versionUpdatedAt,
  action,
}: {
  mode: "create" | "edit";
  initial: ProjectFormValues;
  clients: SelectOption[];
  managers: SelectOption[];
  /**
   * The statuses this person may choose. Empty means the status is not theirs
   * to set (E-05A §11): a new project starts Pending and an edit leaves it alone.
   */
  statuses: SelectOption[];
  /** The company's own types in use, plus the project's own if it has been retired (E-05A §13, §62). */
  projectTypes: SelectOption[];
  /** The company a new project is created in; `changeHref` when there is a choice (E-05A §30). */
  company?: { id: string; name: string; changeHref?: string };
  /** Cover choices on edit: the project's own images this editor can open (E-05A §8). */
  covers?: { options: SelectOption[]; uploadHref: string };
  cancelHref: string;
  versionUpdatedAt?: string;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const t = useTranslations("projects");
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({ formRef, action, module: "projects", saveKind: mode === "create" ? "create" : "save" });
  const { pending, fieldErrors } = save;

  function onCancel() {
    router.push(cancelHref);
  }

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="space-y-5">
      {versionUpdatedAt ? (
        <input type="hidden" name="versionUpdatedAt" value={versionUpdatedAt} />
      ) : null}

      <SaveMessages save={save} />

      {/* The submitted snapshot saves as it was (AUD-03 §6). */}
      <fieldset disabled={pending || Boolean(save.saved)} aria-busy={pending || undefined} className="m-0 min-w-0 space-y-5 border-0 p-0">

      {company ? (
        <section className="nesto-card flex flex-wrap items-center justify-between gap-3 p-5" data-testid="project-form-company">
          <input type="hidden" name="companyId" value={company.id} />
          <div className="min-w-0">
            <p className="text-meta text-fg-subtle">{t("form.company")}</p>
            <p className="truncate text-card font-semibold text-fg">{company.name}</p>
          </div>
          {company.changeHref ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={company.changeHref}>{t("form.changeCompany")}</Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      <Section title={t("form.details")}>
        <Field label={t("form.name")} name="name" required error={fieldErrors.name}>
          <Input
            id="name"
            name="name"
            defaultValue={initial.name}
            required
            maxLength={160}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? "name-error" : undefined}
          />
        </Field>

        <Field
          label={t("form.code")}
          name="code"
          required
          error={fieldErrors.code}
          hint={t("form.codeHint")}
        >
          <Input
            id="code"
            name="code"
            defaultValue={initial.code}
            required
            maxLength={50}
            aria-invalid={Boolean(fieldErrors.code)}
            aria-describedby={fieldErrors.code ? "code-error" : undefined}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label={t("form.description")} name="description" error={fieldErrors.description}>
            <Textarea
              id="description"
              name="description"
              rows={4}
              defaultValue={initial.description}
              maxLength={5000}
            />
          </Field>
        </div>

        <Field
          label={t("form.type")}
          name="projectTypeId"
          required={mode === "create"}
          error={fieldErrors.projectTypeId}
          hint={projectTypes.length === 0 ? t("form.noTypes") : undefined}
        >
          <FormSelect
            id="projectTypeId"
            name="projectTypeId"
            defaultValue={initial.projectTypeId}
            required={mode === "create"}
            className={selectClass}
            aria-invalid={Boolean(fieldErrors.projectTypeId)}
            aria-describedby={fieldErrors.projectTypeId ? "projectTypeId-error" : undefined}
          >
            {/* A new project is always typed; an older one without a type may stay so. */}
            {mode === "create" ? <option value="">{t("form.chooseType")}</option> : !initial.projectTypeId ? <option value="">{t("form.notSet")}</option> : null}
            {projectTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        {statuses.length > 0 ? (
          <Field label={t("form.status")} name="status" required error={fieldErrors.status}>
            <FormSelect id="status" name="status" defaultValue={initial.status} className={selectClass}>
              {statuses.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </FormSelect>
          </Field>
        ) : (
          <Field
            label={t("form.status")}
            name="status"
            hint={mode === "create" ? t("form.startsPending") : t("form.statusPermission")}
          >
            <p className="flex h-10 items-center text-body text-fg-muted">{(STATUS_KEYS as readonly string[]).includes(initial.status) ? t(`status.${initial.status as (typeof STATUS_KEYS)[number]}`) : initial.status}</p>
          </Field>
        )}

        <Field label={t("form.priority")} name="priority" error={fieldErrors.priority}>
          <FormSelect
            id="priority"
            name="priority"
            defaultValue={initial.priority}
            className={selectClass}
          >
            <option value="">{t("form.noPriority")}</option>
            {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`priority.${value}`)}
              </option>
            ))}
          </FormSelect>
        </Field>
      </Section>

      <Section title={t("form.clientSection")}>
        <Field label={t("form.client")} name="clientId" error={fieldErrors.clientId}>
          <FormSelect
            id="clientId"
            name="clientId"
            defaultValue={initial.clientId}
            className={selectClass}
          >
            <option value="">{t("form.noClient")}</option>
            {clients.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormSelect>
        </Field>

        <Field
          label={t("form.manager")}
          name="projectManagerMemberId"
          error={fieldErrors.projectManagerMemberId}
          hint={t("form.managerHint")}
        >
          <FormSelect
            id="projectManagerMemberId"
            name="projectManagerMemberId"
            defaultValue={initial.projectManagerMemberId}
            className={selectClass}
          >
            <option value="">{t("form.unassigned")}</option>
            {managers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </FormSelect>
        </Field>
      </Section>

      <Section title={t("form.schedule")}>
        <Field label={t("form.startDate")} name="startDate" error={fieldErrors.startDate}>
          <Input id="startDate" name="startDate" type="date" defaultValue={initial.startDate} />
        </Field>
        <Field label={t("form.endDate")} name="endDate" error={fieldErrors.endDate}>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={initial.endDate}
            aria-invalid={Boolean(fieldErrors.endDate)}
            aria-describedby={fieldErrors.endDate ? "endDate-error" : undefined}
          />
        </Field>
      </Section>

      <Section title={t("form.location")}>
        <div className="sm:col-span-2">
          <Field label={t("form.address")} name="address" error={fieldErrors.address}>
            <Input id="address" name="address" defaultValue={initial.address} maxLength={300} />
          </Field>
        </div>
        <Field label={t("form.city")} name="city" error={fieldErrors.city}>
          <Input id="city" name="city" defaultValue={initial.city} maxLength={120} />
        </Field>
        <Field label={t("form.country")} name="country" error={fieldErrors.country}>
          <Input id="country" name="country" defaultValue={initial.country} maxLength={120} />
        </Field>
        <Field label={t("form.builtArea")} name="builtArea" error={fieldErrors.builtArea}>
          <Input id="builtArea" name="builtArea" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={initial.builtArea} />
        </Field>
        <Field label={t("form.keyProject")} name="isKeyProject" error={fieldErrors.isKeyProject}>
          <FormSelect id="isKeyProject" name="isKeyProject" defaultValue={initial.isKeyProject} className={selectClass}>
            <option value="NO">{t("form.no")}</option>
            <option value="YES">{t("form.yes")}</option>
          </FormSelect>
        </Field>
      </Section>

      {covers ? (
        <Section title={t("form.coverImage")}>
          <div className="sm:col-span-2">
            <Field
              label={t("form.cover")}
              name="coverImageDocumentId"
              error={fieldErrors.coverImageDocumentId}
              hint={
                covers.options.length === 0
                  ? t("form.coverUploadHint")
                  : t("form.coverChooseHint")
              }
            >
              <FormSelect
                id="coverImageDocumentId"
                name="coverImageDocumentId"
                defaultValue={initial.coverImageDocumentId}
                className={selectClass}
              >
                <option value="">{t("form.noCover")}</option>
                {covers.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FormSelect>
            </Field>
            <Link href={covers.uploadHref} className="mt-2 inline-block text-table font-medium text-accent-strong">
              {t("form.openDocuments")}
            </Link>
          </div>
        </Section>
      ) : null}

      </fieldset>

      {/* Phone action bar: clear of the home indicator, and marked so focus scrolling keeps fields out from under it (AUD-04 §6, MW-08). */}
      <div
        data-sticky-action-bar
        className={cn(
          "flex flex-wrap items-center justify-end gap-2",
          "sticky bottom-0 z-30 -mx-4 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:static md:z-auto md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-3 md:backdrop-blur-none",
        )}
      >
        <UnsavedIndicator save={save} className="mr-auto" />
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          {t("form.cancel")}
        </Button>
        <Button type="submit" disabled={pending || Boolean(save.saved)}>
          {pending
            ? mode === "create"
              ? t("form.creating")
              : t("form.saving")
            : mode === "create"
              ? t("form.create")
              : t("form.save")}
        </Button>
      </div>

      <p className="text-meta text-fg-subtle">
        {t("form.needToLeave")}{" "}
        <Link href={cancelHref} className="underline underline-offset-2">
          {t("form.returnWithoutSaving")}
        </Link>
        .
      </p>
    </form>
  );
}
