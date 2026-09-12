"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import {
  assignHazardAction,
  assignHseActionAction,
  assignInspectionAction,
  assignInvestigatorAction,
} from "@/lib/actions/hse";

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

const LABEL: Record<Kind, string> = {
  inspection: "Reassign inspector",
  hazard: "Assign",
  incident: "Assign investigator",
  action: "Reassign",
};

const DESCRIPTION: Record<Kind, string> = {
  inspection: "The inspection becomes theirs to carry out.",
  hazard: "They own getting the control in.",
  incident: "Investigating is a named job. Somebody has to be accountable for it.",
  action: "They carry it out; somebody else verifies it.",
};

export function AssignControl({ kind, recordId }: { kind: Kind; recordId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [members, setMembers] = React.useState<{ id: string; name: string }[] | null>(null);
  const [memberId, setMemberId] = React.useState("");

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

  function assign() {
    if (!memberId) return;

    startTransition(async () => {
      const result =
        kind === "inspection"
          ? await assignInspectionAction(recordId, memberId)
          : kind === "hazard"
            ? await assignHazardAction(recordId, memberId)
            : kind === "incident"
              ? await assignInvestigatorAction(recordId, memberId)
              : await assignHseActionAction(recordId, memberId);

      if (result.ok) {
        setOpen(false);
        toast({ title: result.message ?? "Assigned.", tone: "success" });
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {LABEL[kind]}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>{LABEL[kind]}</DialogTitle>
          <DialogDescription>{DESCRIPTION[kind]}</DialogDescription>

          <div className="space-y-1.5">
            <Label htmlFor="assign-member">Person</Label>
            <select
              id="assign-member"
              className={selectClass}
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              disabled={members === null}
            >
              <option value="">{members === null ? "Loading…" : "Choose somebody"}</option>
              {(members ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !memberId} onClick={assign}>
              {pending ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
