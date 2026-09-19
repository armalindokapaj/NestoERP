"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, UserPlus } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import {
  addProjectMemberAction,
  removeProjectMemberAction,
  updateProjectMemberAction,
} from "@/lib/actions/projects";
import type { ProjectMemberDTO } from "@/lib/modules/projects/project.types";

export type AssignableMember = {
  id: string;
  name: string;
  detail: string;
};

/**
 * Project team management (PRD #10 §69–§78).
 *
 * Every control is conditional on the specific permission behind it: viewing,
 * adding, editing and removing are four separate grants (PRD #10 §119).
 * Removal marks the membership inactive rather than deleting history, and the
 * acting project manager cannot be removed without first reassigning
 * (PRD #10 §76, §77).
 */
export function ProjectTeam({
  projectId,
  members,
  assignable,
  managerMemberId,
  canAdd,
  canUpdate,
  canRemove,
  openTaskCounts,
}: {
  projectId: string;
  members: ProjectMemberDTO[];
  assignable: AssignableMember[];
  managerMemberId: string | null;
  canAdd: boolean;
  canUpdate: boolean;
  canRemove: boolean;
  /** Open project tasks per member, so removal can warn (PRD #10 §175). */
  openTaskCounts: Record<string, number>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ProjectMemberDTO | null>(null);
  const [removing, setRemoving] = React.useState<ProjectMemberDTO | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const active = members.filter((member) => member.status === "ACTIVE");
  const past = members.filter((member) => member.status !== "ACTIVE");

  function submit(run: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (result.ok) {
        toast({ title: success });
        setAddOpen(false);
        setEditing(null);
        setRemoving(null);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-table text-fg-muted">
          {active.length} active member{active.length === 1 ? "" : "s"}
        </p>
        {canAdd ? (
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={assignable.length === 0}>
            <UserPlus aria-hidden="true" />
            Add member
          </Button>
        ) : null}
      </div>

      {active.length === 0 ? (
        <EmptyState
          title="No one is on this project yet."
          description="Add company members to give them project access."
        />
      ) : (
        <ul className="nesto-card divide-y divide-line">
          {active.map((member) => (
            <li key={member.id} className="flex items-center gap-3 p-4">
              <Avatar
                firstName={member.fullName.split(" ")[0]}
                lastName={member.fullName.split(" ").slice(1).join(" ")}
                src={member.avatarUrl}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-table font-medium text-fg">
                  <PersonLink memberId={member.companyMemberId} name={member.fullName} />
                  {member.companyMemberId === managerMemberId ? (
                    <Badge tone="info">Project manager</Badge>
                  ) : null}
                  {!member.membershipActive ? <Badge tone="warning">Inactive</Badge> : null}
                </p>
                <p className="truncate text-meta text-fg-subtle">
                  {[member.projectRole ?? member.jobTitle, member.roleLabel, member.department]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              {canUpdate || canRemove ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${member.fullName}`}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canUpdate ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          setEditing(member);
                        }}
                      >
                        Edit project role
                      </DropdownMenuItem>
                    ) : null}
                    {canRemove && member.companyMemberId !== managerMemberId ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          setRemoving(member);
                        }}
                      >
                        Remove from project
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 ? (
        <section>
          <h2 className="text-table font-semibold text-fg-muted">Previous members</h2>
          <ul className="mt-2 nesto-card divide-y divide-line">
            {past.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 p-4">
                <span className="text-table text-fg-muted">
                  <PersonLink memberId={member.companyMemberId} name={member.fullName} />
                </span>
                <Badge>Left the project</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Add member ------------------------------------------------------- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            Only active members of your company can be added to a project.
          </DialogDescription>

          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              submit(() => addProjectMemberAction(projectId, formData), "Member added.");
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="companyMemberId">Team member</Label>
              <select
                id="companyMemberId"
                name="companyMemberId"
                required
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                <option value="">Select a person…</option>
                {assignable.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} — {member.detail}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="projectRole">Project role</Label>
              <Input
                id="projectRole"
                name="projectRole"
                placeholder="Lead Architect, Site Engineer…"
                maxLength={120}
              />
              <p className="text-meta text-fg-subtle">
                The role on this project, which is separate from their company role.
              </p>
            </div>

            {error ? (
              <p role="alert" className="text-table text-danger-strong">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAddOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add member"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit project role ------------------------------------------------ */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogTitle>Edit project role</DialogTitle>
          <DialogDescription>{editing?.fullName}</DialogDescription>

          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const memberId = editing!.id;
              submit(
                () => updateProjectMemberAction(projectId, memberId, formData),
                "Project role updated.",
              );
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="editProjectRole">Project role</Label>
              <Input
                id="editProjectRole"
                name="projectRole"
                defaultValue={editing?.projectRole ?? ""}
                maxLength={120}
              />
            </div>

            {error ? (
              <p role="alert" className="text-table text-danger-strong">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(null)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove member ---------------------------------------------------- */}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.fullName ?? "this person"} from the project?`}
        description={
          removing && openTaskCounts[removing.companyMemberId]
            ? `This member has ${openTaskCounts[removing.companyMemberId]} open project task(s). Removing them will not reassign those tasks.`
            : "They keep their company account and their project history is preserved."
        }
        confirmLabel="Remove from project"
        pending={pending}
        onConfirm={() => {
          const memberId = removing!.id;
          submit(() => removeProjectMemberAction(projectId, memberId), "Member removed.");
        }}
      />
    </div>
  );
}
