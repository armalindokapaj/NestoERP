"use client";

import { useCommonTranslations } from "@/components/i18n/common-text";
import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { UnsavedValue } from "@/components/unsaved/unsaved-value";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Handing a record to a colleague.
 *
 * A generic version of the control QA/QC and HSE each carry: the act is the
 * same everywhere — pick somebody active, and the record becomes theirs — so
 * the differences are passed in rather than written out again. The module
 * supplies the endpoint that decides who is eligible and the action that does
 * the assigning, and both re-check permission server-side; nothing here is
 * trusted.
 *
 * The list is fetched when the dialog opens rather than rendered into the
 * page. A picker of every colleague is not something a record page should
 * carry until somebody asks for it.
 */
export type AssignableMember = { id: string; name: string };

export function AssignMemberControl({
  endpoint,
  onAssign,
  triggerLabel,
  title,
  description,
  currentMemberId,
}: {
  /** Returns `{ members }`, scoped and permission-checked by the module. */
  endpoint: string;
  onAssign: (memberId: string) => Promise<{ ok: boolean; message: string }>;
  triggerLabel: string;
  title: string;
  description: string;
  currentMemberId?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useCommonTranslations();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [members, setMembers] = React.useState<AssignableMember[] | null>(null);
  const [memberId, setMemberId] = React.useState(currentMemberId ?? "");

  React.useEffect(() => {
    if (!open || members !== null) return;

    let cancelled = false;
    void fetch(endpoint)
      .then((response) => (response.ok ? response.json() : { members: [] }))
      .then((data: { members?: AssignableMember[] }) => {
        if (!cancelled) setMembers(data.members ?? []);
      })
      .catch(() => {
        // A picker that cannot load is an empty picker, not a broken page.
        if (!cancelled) setMembers([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, members, endpoint]);

  function assign() {
    if (!memberId || memberId === currentMemberId) return;

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof onAssign>>;
      try {
        result = await onAssign(memberId);
      } catch {
        // Sent, unanswered: it may have been assigned (AUD-03 §6).
        toast({ title: t("outcomeUnknown"), tone: "danger" });
        return;
      }
      if (result.ok) {
        setOpen(false);
        toast({ title: result.message, tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.message, tone: "danger" });
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>

          {/* A choice made here is unsaved until Assign runs; nothing else keeps it (AUD-03 §4). */}
          <UnsavedValue saveKind="none" workflow={t("assign.workflow")} label={title} dirty={memberId !== (currentMemberId ?? "")} saving={pending} />
          <div className="space-y-1.5">
            <Label htmlFor="assign-member">{t("assign.person")}</Label>
            <FormSelect
              id="assign-member"
              className={selectClass}
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              disabled={members === null}
            >
              <option value="">{members === null ? t("loading") : t("assign.choose")}</option>
              {(members ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </FormSelect>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("cancel")}</Button>
            </DialogClose>
            <Button
              disabled={pending || !memberId || memberId === currentMemberId}
              onClick={assign}
            >
              {pending ? t("assign.assigning") : t("assign.assign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
