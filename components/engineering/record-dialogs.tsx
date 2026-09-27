"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { engineeringApi, failureMessage } from "./engineering-api";
import { useEngineeringTranslations } from "./engineering-text";
import { FormDialog, ReasonDialog, type FormField } from "./form-kit";
import { documentFields, rfiFields, submittalFields, type ProjectOptions } from "./record-fields";

/**
 * Creating and editing RFIs, submittals and register entries, and the
 * one-click commands around them (PRD #46 §170, §172, §173). Options come from
 * the server already narrowed to what it would accept from this writer.
 */

const EMPTY: ProjectOptions = { contractors: [], workPackages: [], members: [], reviewers: [] };

/**
 * The dialog's options, read when it is first opened. A failed read is said
 * and not cached: the dialog stays closed and the next click tries again. It
 * used to open anyway with empty lists, and an edit then sent "no supplier"
 * for a submittal that had one (AUD-09 §5, FV-09). Resolves whether it loaded.
 */
function useProjectOptions(projectId: string, kind: "rfi" | "submittal" | "document") {
  const toast = useToast();
  const t = useEngineeringTranslations();
  const [options, setOptions] = React.useState<ProjectOptions>(EMPTY);
  const [loaded, setLoaded] = React.useState(false);
  const load = React.useCallback(async (): Promise<boolean> => {
    if (loaded) return true;
    try {
      setOptions(await engineeringApi<ProjectOptions>(`/api/projects/${projectId}/engineering/options?for=${kind}`));
      setLoaded(true);
      return true;
    } catch (failure) {
      toast({ title: t("dialogs.loadChoicesFailed", { message: failureMessage(failure, t("ui.somethingWrong")) }), tone: "danger" });
      return false;
    }
  }, [kind, loaded, projectId, t, toast]);
  return { options, load, loaded };
}

function OpenButton({ label, onOpen, variant = "primary", icon = "plus", testId }: { label: string; onOpen: () => void; variant?: "primary" | "secondary" | "ghost"; icon?: "plus" | "edit" | null; testId?: string }) {
  return (
    <Button type="button" size="sm" variant={variant} onClick={onOpen} data-testid={testId}>
      {icon === "plus" ? <Plus aria-hidden="true" /> : icon === "edit" ? <Pencil aria-hidden="true" /> : null}
      {label}
    </Button>
  );
}

/* RFIs --------------------------------------------------------------------- */

export function NewRfiButton({ projectId, defaults }: { projectId: string; defaults?: Record<string, unknown> }) {
  const [open, setOpen] = React.useState(false);
  const { options, load, loaded } = useProjectOptions(projectId, "rfi");
  const t = useEngineeringTranslations();
  return (
    <>
      <OpenButton label={t("dialogs.newRfi")} testId="new-rfi" onOpen={() => void load().then((ok) => ok && setOpen(true))} />
      {loaded ? (
        <FormDialog
          module="engineering"
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.newRfi")}
          description={t("dialogs.newRfiBody")}
          fields={rfiFields(options, "create", "DRAFT", t)}
          initial={{ priority: "NORMAL", open: true, ...defaults }}
          submitLabel={t("dialogs.saveRfi")}
          saveKind="create"
          wide
          testId="rfi-form"
          onSubmit={async (payload) => {
            const created = await engineeringApi<{ id: string }>(`/api/projects/${projectId}/rfis`, { body: payload });
            return { redirectTo: `/projects/${projectId}/engineering/rfis/${created.id}` };
          }}
        />
      ) : null}
    </>
  );
}

export function EditRfiButton({ projectId, rfi }: { projectId: string; rfi: Record<string, unknown> & { id: string; status: string; version: number } }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const { options, load, loaded } = useProjectOptions(projectId, "rfi");
  const t = useEngineeringTranslations();
  return (
    <>
      <OpenButton label={t("dialogs.edit")} variant="secondary" icon="edit" testId="edit-rfi" onOpen={() => void load().then((ok) => ok && setOpen(true))} />
      {loaded ? (
        <FormDialog
          module="engineering"
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.editRfi")}
          fields={rfiFields(options, "edit", rfi.status, t)}
          initial={rfi}
          submitLabel={t("dialogs.saveChanges")}
          saveKind="save"
          wide
          onSubmit={async (payload) => {
            await engineeringApi(`/api/rfis/${rfi.id}`, { method: "PATCH", body: { ...payload, subject: rfi.status === "DRAFT" ? payload.subject : rfi.subject, question: rfi.status === "DRAFT" ? payload.question : rfi.question, expectedVersion: rfi.version } });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* Submittals --------------------------------------------------------------- */

export function NewSubmittalButton({ projectId, defaultType = "TECHNICAL_SUBMITTAL", label: labelProp }: { projectId: string; defaultType?: string; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const { options, load, loaded } = useProjectOptions(projectId, "submittal");
  const t = useEngineeringTranslations();
  const label = labelProp ?? t("dialogs.newSubmittal");
  return (
    <>
      <OpenButton label={label} testId="new-submittal" onOpen={() => void load().then((ok) => ok && setOpen(true))} />
      {loaded ? (
        <FormDialog
          module="engineering"
          open={open}
          onOpenChange={setOpen}
          title={label}
          description={t("dialogs.newSubmittalBody")}
          fields={submittalFields(options, "create", t)}
          initial={{ submittalType: defaultType }}
          submitLabel={t("dialogs.registerSubmittal")}
          saveKind="create"
          wide
          testId="submittal-form"
          onSubmit={async (payload) => {
            const created = await engineeringApi<{ id: string }>(`/api/projects/${projectId}/submittals`, { body: payload });
            return { redirectTo: `/projects/${projectId}/engineering/submittals/${created.id}` };
          }}
        />
      ) : null}
    </>
  );
}

export function EditSubmittalButton({ projectId, submittal }: { projectId: string; submittal: Record<string, unknown> & { id: string; version: number } }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const { options, load, loaded } = useProjectOptions(projectId, "submittal");
  const t = useEngineeringTranslations();
  return (
    <>
      <OpenButton label={t("dialogs.edit")} variant="secondary" icon="edit" testId="edit-submittal" onOpen={() => void load().then((ok) => ok && setOpen(true))} />
      {loaded ? (
        <FormDialog
          module="engineering"
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.editSubmittal")}
          fields={submittalFields(options, "edit", t)}
          initial={submittal}
          submitLabel={t("dialogs.saveChanges")}
          saveKind="save"
          wide
          onSubmit={async (payload) => {
            await engineeringApi(`/api/submittals/${submittal.id}`, { method: "PATCH", body: { ...payload, expectedVersion: submittal.version } });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* Engineering documents ---------------------------------------------------- */

export function NewDocumentButton({ projectId, drawing = false }: { projectId: string; drawing?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const { options, load, loaded } = useProjectOptions(projectId, "document");
  const t = useEngineeringTranslations();
  const label = drawing ? t("dialogs.registerDrawing") : t("dialogs.registerDocument");
  return (
    <>
      <OpenButton label={label} testId="new-document" onOpen={() => void load().then((ok) => ok && setOpen(true))} />
      {loaded ? (
        <FormDialog
          module="engineering"
          open={open}
          onOpenChange={setOpen}
          title={label}
          description={t("dialogs.registerBody")}
          fields={documentFields(options, drawing, t)}
          initial={{ documentType: drawing ? "DRAWING" : "SPECIFICATION", discipline: "GENERAL" }}
          submitLabel={t("dialogs.register")}
          saveKind="create"
          wide
          testId="document-form"
          onSubmit={async (payload) => {
            const created = await engineeringApi<{ id: string }>(`/api/projects/${projectId}/engineering/documents`, { body: payload });
            return { redirectTo: `/projects/${projectId}/engineering/documents/${created.id}` };
          }}
        />
      ) : null}
    </>
  );
}

export function EditDocumentButton({ projectId, document }: { projectId: string; document: Record<string, unknown> & { id: string; version: number; documentType: string } }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const { options, load, loaded } = useProjectOptions(projectId, "document");
  const t = useEngineeringTranslations();
  return (
    <>
      <OpenButton label={t("dialogs.edit")} variant="secondary" icon="edit" testId="edit-document" onOpen={() => void load().then((ok) => ok && setOpen(true))} />
      {loaded ? (
        <FormDialog
          module="engineering"
          open={open}
          onOpenChange={setOpen}
          title={t("dialogs.editEntry")}
          fields={documentFields(options, document.documentType === "DRAWING" || document.documentType === "SHOP_DRAWING", t)}
          initial={document}
          submitLabel={t("dialogs.saveChanges")}
          saveKind="save"
          wide
          onSubmit={async (payload) => {
            await engineeringApi(`/api/engineering-documents/${document.id}`, { method: "PATCH", body: { ...payload, expectedVersion: document.version } });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/* Commands ----------------------------------------------------------------- */

export type CommandSpec = {
  url: string;
  label: string;
  success: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  testId?: string;
  body?: Record<string, unknown>;
  confirm?: { title: string; description: string; confirmLabel: string; destructive?: boolean };
  reason?: { title: string; description?: string; confirmLabel: string; label?: string; required?: boolean; extraFields?: FormField[]; /** The body field the text goes in; `reason` unless the command names it otherwise. */ name?: string };
  /** Where to go afterwards; otherwise the page refreshes. */
  redirectTo?: string;
};

/** A POST command with an optional confirmation or reason (§172, §252). */
export function CommandButton({ spec }: { spec: CommandSpec }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function send(extra: Record<string, unknown> = {}) {
    setPending(true);
    try {
      await engineeringApi(spec.url, { body: { ...spec.body, ...extra } });
      toast({ title: spec.success, tone: "success" });
      if (spec.redirectTo) router.push(spec.redirectTo);
      else router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
      throw failure;
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={spec.variant ?? "secondary"}
        disabled={pending}
        data-testid={spec.testId}
        onClick={() => {
          if (spec.reason) setAsking(true);
          else if (spec.confirm) setConfirming(true);
          else void send().catch(() => undefined);
        }}
      >
        {spec.label}
      </Button>
      {spec.confirm ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={spec.confirm.title}
          description={spec.confirm.description}
          confirmLabel={spec.confirm.confirmLabel}
          destructive={spec.confirm.destructive ?? false}
          pending={pending}
          onConfirm={() => void send().then(() => setConfirming(false)).catch(() => undefined)}
        />
      ) : null}
      {spec.reason ? (
        <ReasonDialog
          open={asking}
          onOpenChange={setAsking}
          title={spec.reason.title}
          description={spec.reason.description}
          confirmLabel={spec.reason.confirmLabel}
          label={spec.reason.label}
          name={spec.reason.name}
          required={spec.reason.required ?? true}
          extraFields={spec.reason.extraFields}
          onConfirm={(payload) => send(payload)}
        />
      ) : null}
    </>
  );
}

export function CommandBar({ commands, className }: { commands: CommandSpec[]; className?: string }) {
  if (!commands.length) return null;
  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"}>
      {commands.map((spec) => (
        <CommandButton key={`${spec.url}:${spec.label}`} spec={spec} />
      ))}
    </div>
  );
}
