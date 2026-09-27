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
  assignHazardAction,
  assignHseActionAction,
  assignInspectionAction,
  assignInvestigatorAction,
} from "@/lib/actions/hse";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { useHseServerText, useHseTranslations } from "@/components/hse/hse-text";

/**
 * Handing a safety record to somebody (PRD #22 §40, §69, §89, §120).
 *
 * One control for every record kind, because assigning is the same act
 * everywhere: pick an active colleague, and the record becomes theirs.
 *
 * The member list is fetched when the dialog opens rather than rendered into
 * every page: a picker of everybody in the company is not something a record
 * page needs to carry until somebody asks for it.
 */
type Kind = "inspection" | "hazard" | "incident" | "action";

export function AssignControl({ kind, recordId }: { kind: Kind; recordId: string }) {
  const t = useHseTranslations();
  const router = useRouter();
  const toast = useToast();
  const serverText = useHseServerText();
  const [open, setOpen] = React.useState(false);
  const [members, setMembers] = React.useState<{ id: string; name: string }[] | null>(null);

  React.useEffect(() => {
    if (!open || members !== null) return;

    let cancelled = false;
    void fetch("/api/hse/assignable")
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
      kind === "inspection"
        ? await assignInspectionAction(recordId, memberId)
        : kind === "hazard"
          ? await assignHazardAction(recordId, memberId)
          : kind === "incident"
            ? await assignInvestigatorAction(recordId, memberId)
            : await assignHseActionAction(recordId, memberId);

    if (result.ok) {
      toast({ title: serverText(result.message) ?? t("assign.assigned"), tone: "success" });
      setOpen(false);
      router.refresh();
      return true;
    }
    toast({ title: serverText(result.error) ?? result.error, tone: "danger" });
    return false;
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t(`assign.label.${kind}`)}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t(`assign.label.${kind}`)}</DialogTitle>
          <DialogDescription>{t(`assign.description.${kind}`)}</DialogDescription>

          {/* Inside the dialog, so the choice belongs to its guarded close (AUD-03 §5). */}
          <AssignBody members={members} onAssign={assign} label={t(`assign.label.${kind}`)} />
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
  const t = useHseTranslations();
  const close = useDialogClose();
  const [memberId, setMemberId] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const running = React.useRef(false);
  const editor = useUnsavedEditor({ module: "hse", saveKind: "none", workflow: t("assign.label.hazard"), label });
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
      setError(OUTCOME_COPY.unknown);
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
        <Label htmlFor="assign-member">{t("workers.person")}</Label>
        <select
          id="assign-member"
          className={selectClass}
          value={memberId}
          onChange={(event) => setMemberId(event.target.value)}
          disabled={members === null || pending}
        >
          <option value="">{members === null ? t("assign.loading") : t("assign.chooseSomebody")}</option>
          {(members ?? []).map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        {error ? <p className="text-meta text-danger-strong">{error}</p> : null}
      </div>

      <DialogFooter>
        {/* The guarded close, like the X: never a direct setOpen(false) (§5). */}
        <Button variant="secondary" onClick={close} disabled={pending}>
          {t("actions.cancel")}
        </Button>
        <Button disabled={pending || !memberId} onClick={() => void assign()}>
          {pending ? t("assign.assigning") : t("assign.label.hazard")}
        </Button>
      </DialogFooter>
    </>
  );
}
