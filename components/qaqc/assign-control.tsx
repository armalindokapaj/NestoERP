"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  useDialogClose,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import {
  assignActionAction,
  assignDefectAction,
  assignInspectionAction,
  assignNcrAction,
  assignRequestAction,
} from "@/lib/actions/qaqc";
import { useCommonTranslations } from "@/components/i18n/common-text";
import type { MessageKey } from "@/lib/i18n/translator";
import { useQaqcTranslations } from "./qaqc-text";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Handing a quality record to somebody (PRD #21 §45, §74, §117, §130, §145).
 *
 * One control for all five record kinds, because assigning is the same act
 * everywhere: pick an active colleague, and the record becomes theirs.
 *
 * The member list is fetched when the dialog opens rather than rendered into
 * every page: a picker of everybody in the company is not something a record
 * page needs to carry until somebody asks for it.
 */
type Kind = "request" | "inspection" | "defect" | "ncr" | "action";

const LABEL: Record<Kind, MessageKey<"qaqc">> = {
  request: "assign.assignInspector",
  inspection: "assign.reassign",
  defect: "assign.assign",
  ncr: "assign.assign",
  action: "assign.reassign",
};

/** What the server says on success, word for word, in the reader's language. */
const ASSIGNED: Record<Kind, MessageKey<"qaqc">> = {
  request: "assign.inspectorAssigned",
  inspection: "assign.inspectorAssigned",
  defect: "assign.defectAssigned",
  ncr: "assign.ncrAssigned",
  action: "assign.actionAssigned",
};

export function AssignControl({ kind, recordId }: { kind: Kind; recordId: string }) {
  const router = useRouter();
  const t = useQaqcTranslations();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [members, setMembers] = React.useState<{ id: string; name: string }[] | null>(null);

  React.useEffect(() => {
    if (!open || members !== null) return;

    let cancelled = false;
    void fetch("/api/qaqc/assignable")
      .then((response) => (response.ok ? response.json() : { members: [] }))
      .then((data: { members: { id: string; name: string }[] }) => {
        if (!cancelled) setMembers(data.members);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, members]);

  /** Resolves true once assigned; a thrown request stays thrown, for the dialog to say so. */
  async function assign(memberId: string): Promise<boolean> {
    const result =
      kind === "request"
        ? await assignRequestAction(recordId, memberId)
        : kind === "inspection"
          ? await assignInspectionAction(recordId, memberId)
          : kind === "defect"
            ? await assignDefectAction(recordId, memberId)
            : kind === "ncr"
              ? await assignNcrAction(recordId, memberId)
              : await assignActionAction(recordId, memberId);

    if (result.ok) {
      toast({ title: t(ASSIGNED[kind]), tone: "success" });
      setOpen(false);
      router.refresh();
      return true;
    }
    toast({ title: result.error, tone: "danger" });
    return false;
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t(LABEL[kind])}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t(LABEL[kind])}</DialogTitle>
          <DialogDescription>
            {kind === "request"
              ? t("assign.requestBody")
              : t("assign.recordBody")}
          </DialogDescription>

          {/* Inside the dialog, so the choice belongs to its guarded close (AUD-03 §5). */}
          <AssignBody members={members} onAssign={assign} label={t(LABEL[kind])} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The choice itself (AUD-03 §3, §5). Assigning is a workflow step, so a chosen
 * person is registered as workflow-only: closing the dialog with somebody
 * picked asks first — the X, Escape, the backdrop and Cancel alike — and
 * "Save and continue" never assigns anyone. The choice lives in here, so it
 * starts empty each time the dialog opens and survives a refused close.
 */
function AssignBody({
  members,
  onAssign,
  label,
}: {
  members: { id: string; name: string }[] | null;
  onAssign: (memberId: string) => Promise<boolean>;
  label: string;
}) {
  const close = useDialogClose();
  const t = useQaqcTranslations();
  const tc = useCommonTranslations();
  const [memberId, setMemberId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const running = React.useRef(false);
  const editor = useUnsavedEditor({ module: "qaqc", saveKind: "none", workflow: t("assign.assign"), label });
  const { setDirty, setSaving, setUnresolved } = editor;

  React.useEffect(() => setDirty(memberId !== ""), [memberId, setDirty]);

  async function assign() {
    if (!memberId || running.current) return;
    running.current = true;
    setPending(true);
    setSaving(true);
    setError(null);
    let ok = false;
    try {
      ok = await onAssign(memberId);
    } catch {
      // It may or may not have happened: say so, never retry it (§6).
      setUnresolved(true);
      setError(tc("outcomeUnknown"));
    } finally {
      running.current = false;
      setPending(false);
      setSaving(false);
    }
    if (ok) {
      setUnresolved(false);
      setDirty(false);
    }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="assign-member">{tc("assign.person")}</Label>
        <FormSelect
          id="assign-member"
          className={selectClass}
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
          disabled={members === null || pending}
        >
          <option value="">{members === null ? tc("loading") : tc("assign.choose")}</option>
          {(members ?? []).map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </FormSelect>
        {error ? <p className="text-meta text-danger-strong">{error}</p> : null}
      </div>

      <DialogFooter>
        {/* The guarded close, like the X: never a direct setOpen(false) (§5). */}
        <Button variant="secondary" onClick={close} disabled={pending}>
          {tc("cancel")}
        </Button>
        <Button disabled={pending || !memberId} onClick={() => void assign()}>
          {pending ? tc("assign.assigning") : tc("assign.assign")}
        </Button>
      </DialogFooter>
    </>
  );
}
