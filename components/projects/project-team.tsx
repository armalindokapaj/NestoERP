"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { useRouter } from "@/components/navigation/guarded-router";
import { MoreHorizontal, UserPlus } from "lucide-react";

import { PersonLink } from "@/components/people/person-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogClose,
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
import { SaveMessages } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import {
  addProjectMemberAction,
  removeProjectMemberAction,
  updateProjectMemberAction,
  type ActionResult,
} from "@/lib/actions/projects";
import type { ProjectMemberDTO } from "@/lib/modules/projects/project.types";
import { FormSelect } from "@/components/ui/form-select";

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
  const t = useTranslations("projects");
  const [pending, startTransition] = React.useTransition();

  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ProjectMemberDTO | null>(null);
  const [removing, setRemoving] = React.useState<ProjectMemberDTO | null>(null);

  const active = members.filter((member) => member.status === "ACTIVE");
  const past = members.filter((member) => member.status !== "ACTIVE");

  function remove(memberId: string) {
    startTransition(async () => {
      const result = await removeProjectMemberAction(projectId, memberId);
      if (result.ok) {
        toast({ title: t("team.removed") });
        setRemoving(null);
        router.refresh();
      } else {
        toast({ title: result.error, tone: "danger" });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-table text-fg-muted">
          {t("team.activeMembers", { count: active.length })}
        </p>
        {canAdd ? (
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={assignable.length === 0}>
            <UserPlus aria-hidden="true" />
            {t("team.addMember")}
          </Button>
        ) : null}
      </div>

      {active.length === 0 ? (
        <EmptyState
          title={t("team.emptyTitle")}
          description={t("team.emptyBody")}
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
                    <Badge tone="info">{t("team.projectManager")}</Badge>
                  ) : null}
                  {!member.membershipActive ? <Badge tone="warning">{t("team.inactive")}</Badge> : null}
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
                      aria-label={t("team.actionsFor", { name: member.fullName })}
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
                        {t("team.editRole")}
                      </DropdownMenuItem>
                    ) : null}
                    {canRemove && member.companyMemberId !== managerMemberId ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          setRemoving(member);
                        }}
                      >
                        {t("team.removeFromProject")}
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
          <h2 className="text-table font-semibold text-fg-muted">{t("team.previous")}</h2>
          <ul className="mt-2 nesto-card divide-y divide-line">
            {past.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 p-4">
                <span className="text-table text-fg-muted">
                  <PersonLink memberId={member.companyMemberId} name={member.fullName} />
                </span>
                <Badge>{t("team.leftProject")}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Add member ------------------------------------------------------- */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogTitle>{t("team.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("team.addBody")}
          </DialogDescription>

          <MemberForm
            label={t("team.newMemberLabel")}
            saveKind="create"
            action={(formData) => addProjectMemberAction(projectId, formData)}
            success={t("team.added")}
            submitLabel={t("team.addMember")}
            pendingLabel={t("team.adding")}
            onDone={() => setAddOpen(false)}
          >
            <div className="space-y-1.5">
              <Label htmlFor="companyMemberId">{t("team.member")}</Label>
              <FormSelect
                id="companyMemberId"
                name="companyMemberId"
                required
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                <option value="">{t("team.selectPerson")}</option>
                {assignable.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} — {member.detail}
                  </option>
                ))}
              </FormSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="projectRole">{t("team.projectRole")}</Label>
              <Input
                id="projectRole"
                name="projectRole"
                placeholder={t("team.rolePlaceholder")}
                maxLength={120}
              />
              <p className="text-meta text-fg-subtle">
                {t("team.roleHint")}
              </p>
            </div>
          </MemberForm>
        </DialogContent>
      </Dialog>

      {/* Edit project role ------------------------------------------------ */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogTitle>{t("team.editRole")}</DialogTitle>
          <DialogDescription>{editing?.fullName}</DialogDescription>

          {editing ? (
            <MemberForm
              label={t("team.roleOf", { name: editing.fullName })}
              saveKind="save"
              action={(formData) => updateProjectMemberAction(projectId, editing.id, formData)}
              success={t("team.roleUpdated")}
              submitLabel={t("team.save")}
              pendingLabel={t("team.saving")}
              onDone={() => setEditing(null)}
            >
              <div className="space-y-1.5">
                <Label htmlFor="editProjectRole">{t("team.projectRole")}</Label>
                <Input
                  id="editProjectRole"
                  name="projectRole"
                  defaultValue={editing.projectRole ?? ""}
                  maxLength={120}
                />
              </div>
            </MemberForm>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Remove member ---------------------------------------------------- */}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("team.removeTitle", { name: removing?.fullName ?? t("team.thisPerson") })}
        description={
          removing && openTaskCounts[removing.companyMemberId]
            ? t("team.removeOpenTasks", { count: openTaskCounts[removing.companyMemberId]! })
            : t("team.removeBody")
        }
        confirmLabel={t("team.removeFromProject")}
        pending={pending}
        onConfirm={() => remove(removing!.id)}
      />
    </div>
  );
}

/**
 * One member dialog's form, under the unsaved-work contract (AUD-03 §5, §6):
 * it registers inside the dialog, so the X, Escape, the backdrop and Cancel ask
 * before throwing a choice away, and only a committed answer closes it.
 */
function MemberForm({
  label,
  saveKind,
  action,
  success,
  submitLabel,
  pendingLabel,
  onDone,
  children,
}: {
  label: string;
  saveKind: "save" | "create";
  action: (formData: FormData) => Promise<ActionResult>;
  success: string;
  submitLabel: string;
  pendingLabel: string;
  onDone: () => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("projects");
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    action,
    module: "projects",
    saveKind,
    label,
    onCommitted: () => {
      toast({ title: success });
      onDone();
      router.refresh();
      return true;
    },
  });

  return (
    <form ref={formRef} className="mt-4 space-y-4" onSubmit={save.onSubmit}>
      <SaveMessages save={save} />
      <fieldset disabled={save.pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
        {children}
      </fieldset>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={save.pending}>
            {t("team.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={save.pending}>
          {save.pending ? pendingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
