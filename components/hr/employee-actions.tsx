"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, PenLine, UserRoundCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { employmentStatusAction, rehireAction } from "@/lib/actions/hr";
import { EMPLOYMENT_STATUSES } from "@/lib/modules/hr/hr.schema";
import { canTransitionEmployment, employmentStatusLabels } from "@/lib/modules/hr/hr.status";
import type { EmployeeDetailDTO } from "@/lib/modules/hr/hr.types";
import type { EmploymentStatus } from "@prisma/client";

const selectClass =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20";

/**
 * Header actions for an employment record (PRD #16 §54, §56, §127).
 *
 * Status is changed here rather than on the edit form, because it is a
 * transition with rules — and because ending employment is not the same act as
 * removing somebody's access to NESTO. What this does is end the employment;
 * the company membership is Team's to deactivate, by somebody who holds Team's
 * permission (PRD #16 §126, §230).
 */
export function EmployeeActions({ employee }: { employee: EmployeeDetailDTO }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [changing, setChanging] = React.useState(false);
  const [rehiring, setRehiring] = React.useState(false);

  const current = employee.employmentStatus;
  const reachable = EMPLOYMENT_STATUSES.filter(
    (status) => status !== current && canTransitionEmployment(current, status as EmploymentStatus),
  ) as EmploymentStatus[];

  const [nextStatus, setNextStatus] = React.useState<EmploymentStatus>(reachable[0] ?? "ACTIVE");
  const [endDate, setEndDate] = React.useState(employee.endDate ?? "");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [startDate, setStartDate] = React.useState(new Date().toISOString().slice(0, 10));

  function changeStatus(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await employmentStatusAction(employee.memberId, {
        status: nextStatus,
        ...(nextStatus === "ENDED" && endDate ? { endDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });

      if (result.ok) {
        setChanging(false);
        setNote("");
        toast({ title: `Employment ${employmentStatusLabels[nextStatus].toLowerCase()}.`, tone: "success" });
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function rehire(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await rehireAction(employee.memberId, startDate);
      if (result.ok) {
        setRehiring(false);
        toast({ title: "Employee rehired.", tone: "success" });
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      {employee.capabilities.canEditEmployment ? (
        <Button asChild variant="secondary" size="sm">
          <Link href={`/hr/employees/${employee.memberId}/employment/edit`}>
            <PenLine aria-hidden="true" />
            Edit employment
          </Link>
        </Button>
      ) : null}

      {employee.capabilities.canChangeStatus && reachable.length > 0 ? (
        <Button size="sm" onClick={() => setChanging(true)}>
          <UserRoundCheck aria-hidden="true" />
          Change status
        </Button>
      ) : null}

      {employee.capabilities.canChangeStatus && current === "ENDED" ? (
        <Button size="sm" onClick={() => setRehiring(true)}>
          <CalendarPlus aria-hidden="true" />
          Rehire
        </Button>
      ) : null}

      <Dialog
        open={changing}
        onOpenChange={(open) => {
          setChanging(open);
          if (!open) setError(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Change employment status</DialogTitle>
          <DialogDescription>
            This changes employment only. Company access is managed in Team, and is not touched
            here.
          </DialogDescription>

          <form onSubmit={changeStatus} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="employment-status">New status</Label>
              <select
                id="employment-status"
                className={selectClass}
                value={nextStatus}
                onChange={(event) => setNextStatus(event.target.value as EmploymentStatus)}
              >
                {reachable.map((status) => (
                  <option key={status} value={status}>
                    {employmentStatusLabels[status]}
                  </option>
                ))}
              </select>
            </div>

            {nextStatus === "ENDED" ? (
              <div className="space-y-1.5">
                <Label htmlFor="employment-end-date">Last day</Label>
                <Input
                  id="employment-end-date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
                {employee.guards.openLeaveRequests > 0 || employee.guards.managedEmployees > 0 ? (
                  <p className="text-meta text-fg-subtle">
                    {employee.guards.openLeaveRequests > 0
                      ? `${employee.guards.openLeaveRequests} open leave request(s). `
                      : ""}
                    {employee.guards.managedEmployees > 0
                      ? `Manages ${employee.guards.managedEmployees} employee(s). `
                      : ""}
                    Nothing is reassigned automatically.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="employment-note">Note</Label>
              <Textarea
                id="employment-note"
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional, and kept with the record."
              />
            </div>

            {error ? (
              <p role="alert" className="text-meta text-danger-strong">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setChanging(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Change status"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rehiring}
        onOpenChange={(open) => {
          setRehiring(open);
          if (!open) setError(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Rehire {employee.name.fullName}</DialogTitle>
          <DialogDescription>
            A rehire needs its own start date, and clears the old end date. The previous employment
            stays in the activity trail.
          </DialogDescription>

          <form onSubmit={rehire} className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rehire-start-date">New start date</Label>
              <Input
                id="rehire-start-date"
                type="date"
                required
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>

            {error ? (
              <p role="alert" className="text-meta text-danger-strong">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRehiring(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Rehiring…" : "Rehire"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
