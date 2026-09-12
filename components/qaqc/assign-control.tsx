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
  assignActionAction,
  assignDefectAction,
  assignInspectionAction,
  assignNcrAction,
  assignRequestAction,
} from "@/lib/actions/qaqc";

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

const LABEL: Record<Kind, string> = {
  request: "Assign inspector",
  inspection: "Reassign",
  defect: "Assign",
  ncr: "Assign",
  action: "Reassign",
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

  function assign() {
    if (!memberId) return;

    startTransition(async () => {
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
          <DialogDescription>
            {kind === "request"
              ? "Assigning an inspector is what turns a request into work."
              : "The record becomes theirs to carry out."}
          </DialogDescription>

          <div className="space-y-1.5">
            <Label htmlFor="assign-member">Person</Label>
            <select
              id="assign-member"
              className={selectClass}
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              disabled={members === null}
            >
              <option value="">
                {members === null ? "Loading…" : "Choose somebody"}
              </option>
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
