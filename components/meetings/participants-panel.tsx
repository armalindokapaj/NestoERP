"use client";

import * as React from "react";
import { Crown, Loader2, MoreHorizontal, UserPlus } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { PersonLink } from "@/components/people/person-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import {
  ATTENDANCE_LABELS,
  PARTICIPANT_ROLE_LABELS,
  RESPONSE_LABELS,
  type MeetingDetailDTO,
  type MeetingParticipantDTO,
} from "@/lib/modules/meetings/meeting.types";
import { meetingsLabel } from "@/lib/i18n/modules/meetings/labels";
import { cn } from "@/lib/utils/cn";
import { failureMessage, meetingApi, meetingFailureOutcome } from "./meeting-api";
import { PersonAvatar } from "./meeting-ui";
import { useMeetingsTranslations } from "./meetings-text";
import { PeoplePicker, type PickedPerson } from "./people-picker";
import { FormSelect } from "@/components/ui/form-select";

/**
 * Who is on the meeting (PRD #40 §18-§23, §112-§114, §131-§136).
 *
 * Replies and attendance stay distinct: the reply is what someone planned, the
 * attendance what happened (PRD #40 §257). Management actions — role, optional,
 * remove, hand over as organizer — appear only when the server said this reader
 * may take them.
 */

type Role = "CHAIR" | "SECRETARY" | "ATTENDEE" | "OBSERVER";
const ROLES: Role[] = ["CHAIR", "SECRETARY", "ATTENDEE", "OBSERVER"];

const RESPONSE_DOT: Record<string, string> = {
  ACCEPTED: "bg-success-strong",
  TENTATIVE: "bg-warning-strong",
  DECLINED: "bg-fg-subtle",
  PENDING: "bg-line-strong",
};

export function ParticipantsPanel({
  meeting,
  onChange,
  variant = "rail",
}: {
  meeting: MeetingDetailDTO;
  onChange: (detail: MeetingDetailDTO) => void;
  variant?: "rail" | "attendance";
}) {
  const toast = useToast();
  const t = useMeetingsTranslations();
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<MeetingParticipantDTO | null>(null);
  const [handing, setHanding] = React.useState<MeetingParticipantDTO | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const caps = meeting.capabilities;

  const counts = meeting.participants.reduce<Record<string, number>>((all, row) => ({ ...all, [row.response]: (all[row.response] ?? 0) + 1 }), {});

  async function patch(memberId: string, body: Record<string, unknown>) {
    setBusy(memberId);
    try {
      onChange(await meetingApi<MeetingDetailDTO>(`/api/meetings/${meeting.id}/participants/${memberId}`, { method: "PATCH", body }));
    } catch (error) {
      toast({ title: failureMessage(error, t("participants.changeFailed")), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(person: MeetingParticipantDTO, scope: "THIS" | "FUTURE") {
    setBusy(person.memberId);
    try {
      onChange(await meetingApi<MeetingDetailDTO>(`/api/meetings/${meeting.id}/participants/${person.memberId}${scope === "FUTURE" ? "?scope=FUTURE" : ""}`, { method: "DELETE" }));
      toast({ title: t("participants.removed", { name: person.fullName }), tone: "success" });
    } catch (error) {
      toast({ title: failureMessage(error, t("participants.removeFailed")), tone: "danger" });
    } finally {
      setBusy(null);
      setRemoving(null);
    }
  }

  async function handOver(person: MeetingParticipantDTO) {
    setBusy(person.memberId);
    try {
      onChange(await meetingApi<MeetingDetailDTO>(`/api/meetings/${meeting.id}/organizer`, { body: { memberId: person.memberId } }));
      toast({ title: t("participants.handed", { name: person.fullName }), tone: "success" });
    } catch (error) {
      toast({ title: failureMessage(error, t("participants.handFailed")), tone: "danger" });
    } finally {
      setBusy(null);
      setHanding(null);
    }
  }

  return (
    <section aria-labelledby={`participants-${variant}`} className={cn(variant === "rail" && "nesto-card p-5")} data-testid="participants-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`participants-${variant}`} className="text-card font-semibold text-fg">
          {variant === "attendance" ? t("participants.attendance") : t("participants.participants")}
          <span className="ml-1.5 text-table font-normal text-fg-subtle">{meeting.participants.length}</span>
        </h2>
        {caps.canManageParticipants && variant === "rail" ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" />
            {t("participants.add")}
          </Button>
        ) : null}
      </div>
      {variant === "rail" ? (
        <p className="mt-1 text-meta text-fg-subtle">
          {[counts.ACCEPTED ? t("participants.accepted", { count: counts.ACCEPTED }) : null, counts.TENTATIVE ? t("participants.tentative", { count: counts.TENTATIVE }) : null, counts.DECLINED ? t("participants.declined", { count: counts.DECLINED }) : null, counts.PENDING ? t("participants.awaiting", { count: counts.PENDING }) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}

      <ul className="mt-3 space-y-1">
        {meeting.participants.map((person) => (
          <li key={person.memberId} className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-hover/60" data-testid="participant-row">
            <span className="relative">
              <PersonAvatar person={person} />
              <span aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface", RESPONSE_DOT[person.response])} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("flex items-center gap-1 truncate text-table text-fg", !person.active && "text-fg-muted")}>
                <PersonLink memberId={person.memberId} name={person.fullName} />
                {person.role === "ORGANIZER" ? <Crown aria-hidden="true" className="size-3 shrink-0 text-accent-strong" /> : null}
              </span>
              <span className="block truncate text-meta text-fg-subtle">
                {[meetingsLabel(t, "role", person.role, PARTICIPANT_ROLE_LABELS[person.role]), person.required ? null : t("common.optional"), person.role === "ORGANIZER" ? null : meetingsLabel(t, "response", person.response, RESPONSE_LABELS[person.response]), person.active ? null : t("participants.noLongerMember")].filter(Boolean).join(" · ")}
              </span>
            </span>

            {caps.canRecordAttendance ? (
              <FormSelect
                aria-label={t("participants.attendanceFor", { name: person.fullName })}
                value={person.attendance}
                disabled={busy === person.memberId}
                onChange={(change) => void patch(person.memberId, { attendance: change.target.value })}
                className={cn(
                  "h-8 rounded-md border px-1.5 text-meta",
                  person.attendance === "PRESENT" ? "border-success-strong/40 bg-success-soft text-success-strong" : person.attendance === "UNKNOWN" ? "border-line bg-surface text-fg-muted" : "border-line bg-surface-muted text-fg",
                )}
              >
                {(["UNKNOWN", "PRESENT", "ABSENT", "EXCUSED"] as const).map((status) => (
                  <option key={status} value={status}>
                    {meetingsLabel(t, "attendance", status, ATTENDANCE_LABELS[status])}
                  </option>
                ))}
              </FormSelect>
            ) : person.attendance !== "UNKNOWN" && meeting.status !== "SCHEDULED" ? (
              <span className="text-meta text-fg-muted">{meetingsLabel(t, "attendance", person.attendance, ATTENDANCE_LABELS[person.attendance])}</span>
            ) : null}

            {busy === person.memberId ? <Loader2 aria-hidden="true" className="size-4 animate-spin text-fg-subtle" /> : null}

            {caps.canManageParticipants && person.role !== "ORGANIZER" && variant === "rail" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={t("participants.manage", { name: person.fullName })} className="grid place-items-center rounded-md p-1 text-fg-subtle opacity-70 outline-none hover:bg-hover hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 touch:size-11 touch:p-0 touch:opacity-100">
                    <MoreHorizontal aria-hidden="true" className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ROLES.filter((role) => role !== person.role).map((role) => (
                    <DropdownMenuItem key={role} onSelect={() => void patch(person.memberId, { role })}>
                      {t("participants.make", { role: meetingsLabel(t, "roleLower", role, PARTICIPANT_ROLE_LABELS[role].toLowerCase()) })}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onSelect={() => void patch(person.memberId, { required: !person.required })}>{person.required ? t("participants.markOptional") : t("participants.markRequired")}</DropdownMenuItem>
                  {caps.canTransferOrganizer && person.active ? <DropdownMenuItem onSelect={() => setHanding(person)}>{t("participants.handOver")}</DropdownMenuItem> : null}
                  <DropdownMenuItem onSelect={() => setRemoving(person)} className="text-danger-strong">
                    {t("participants.removeFromMeeting")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        ))}
      </ul>

      <AddPeopleDialog open={adding} onOpenChange={setAdding} meeting={meeting} onChange={onChange} />

      <Dialog open={removing !== null} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("participants.removeTitle", { name: removing?.fullName ?? "" })}</DialogTitle>
          <DialogDescription>
            {meeting.series ? t("participants.removeSeries") : t("participants.removeSingle")}
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setRemoving(null)} disabled={busy !== null}>
              {t("common.cancel")}
            </Button>
            {meeting.series ? (
              <Button type="button" variant="secondary" onClick={() => removing && void remove(removing, "FUTURE")} disabled={busy !== null}>
                {t("participants.thisAndLater")}
              </Button>
            ) : null}
            <Button type="button" variant="danger" onClick={() => removing && void remove(removing, "THIS")} disabled={busy !== null}>
              {meeting.series ? t("participants.thisMeeting") : t("common.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={handing !== null}
        onOpenChange={(open) => (open ? null : setHanding(null))}
        title={t("participants.handTitle", { name: handing?.fullName ?? "" })}
        description={t("participants.handDescription")}
        confirmLabel={t("participants.handConfirm")}
        destructive={false}
        pending={busy !== null}
        onConfirm={() => handing && void handOver(handing)}
      />
    </section>
  );
}

function AddPeopleDialog({ open, onOpenChange, meeting, onChange }: { open: boolean; onOpenChange: (open: boolean) => void; meeting: MeetingDetailDTO; onChange: (detail: MeetingDetailDTO) => void }) {
  const t = useMeetingsTranslations();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("participants.addTitle")}</DialogTitle>
        <DialogDescription>{meeting.status === "DRAFT" ? t("participants.addDraft") : t("participants.addNow")}</DialogDescription>
        {/* Inside the dialog, so the people picked belong to its guarded close (AUD-03 §5). Mounted on open: it starts empty. */}
        <AddPeopleForm meeting={meeting} onChange={onChange} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddPeopleForm({ meeting, onChange, onDone }: { meeting: MeetingDetailDTO; onChange: (detail: MeetingDetailDTO) => void; onDone: () => void }) {
  const toast = useToast();
  const t = useMeetingsTranslations();
  const [picked, setPicked] = React.useState<Array<PickedPerson & { role: Role }>>([]);
  const [scope, setScope] = React.useState<"THIS" | "FUTURE">("THIS");
  const [pending, setPending] = React.useState(false);

  // On a draft meeting adding people is an ordinary save; otherwise it sends
  // their invitations — a workflow step the prompt never takes (AUD-03 §3).
  const draft = meeting.status === "DRAFT";
  const run = React.useRef<() => Promise<SaveOutcome>>(async () => ({ kind: "unknown" }));
  const editor = useUnsavedEditor({ module: "meetings", saveKind: draft ? "create" : "none", workflow: t("participants.addWorkflow"), label: t("participants.addTitle"), save: draft ? () => run.current() : undefined });
  const { setDirty, setSaving, setUnresolved } = editor;
  React.useEffect(() => setDirty(picked.length > 0 || scope !== "THIS"), [picked, scope, setDirty]);

  run.current = async () => {
    if (pending) return { kind: "unknown" };
    if (picked.length === 0) return { kind: "invalid" };
    setPending(true);
    setSaving(true);
    try {
      onChange(
        await meetingApi<MeetingDetailDTO>(`/api/meetings/${meeting.id}/participants`, {
          body: { participants: picked.map((person) => ({ memberId: person.memberId, role: person.role, required: true })), scope },
        }),
      );
      setDirty(false);
      setUnresolved(false);
      setSaving(false);
      toast({ title: picked.length === 1 ? t("participants.added", { name: picked[0].fullName }) : t("participants.addedMany", { count: picked.length }), tone: "success" });
      onDone();
      return { kind: "committed" };
    } catch (error) {
      const outcome = meetingFailureOutcome(error);
      setUnresolved(outcome.kind === "unknown");
      toast({ title: failureMessage(error, t("participants.addFailed")), tone: "danger" });
      return outcome;
    } finally {
      setPending(false);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mt-4 space-y-3">
        <Label htmlFor="add-people" className="sr-only">
          {t("participants.find")}
        </Label>
        <PeoplePicker id="add-people" exclude={[...meeting.participants.map((row) => row.memberId), ...picked.map((row) => row.memberId)]} onPick={(person) => setPicked((rows) => [...rows, { ...person, role: "ATTENDEE" }])} />
        {picked.length > 0 ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {picked.map((person) => (
              <li key={person.memberId} className="flex items-center gap-2.5 px-3 py-2">
                <PersonAvatar person={person} />
                <span className="min-w-0 flex-1 truncate text-table text-fg">{person.fullName}</span>
                <FormSelect
                  aria-label={`Role for ${person.fullName}`}
                  className="h-8 rounded-md border border-line bg-surface px-2 text-meta"
                  value={person.role}
                  onChange={(change) => setPicked((rows) => rows.map((row) => (row.memberId === person.memberId ? { ...row, role: change.target.value as Role } : row)))}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {meetingsLabel(t, "role", role, PARTICIPANT_ROLE_LABELS[role])}
                    </option>
                  ))}
                </FormSelect>
                <button type="button" className="text-meta text-fg-subtle hover:text-fg" onClick={() => setPicked((rows) => rows.filter((row) => row.memberId !== person.memberId))}>
                  {t("common.remove")}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {meeting.series ? (
          <div className="space-y-1">
            <Label htmlFor="add-people-scope">{t("participants.addTo")}</Label>
            <FormSelect id="add-people-scope" className={selectClass} value={scope} onChange={(change) => setScope(change.target.value as "THIS" | "FUTURE")}>
              <option value="THIS">{t("participants.thisOnly")}</option>
              <option value="FUTURE">{t("participants.everyLater")}</option>
            </FormSelect>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={pending}>
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="button" onClick={() => void run.current()} disabled={pending || picked.length === 0}>
          {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {picked.length > 1 ? t("participants.addPeople", { count: picked.length }) : t("participants.addButton")}
        </Button>
      </DialogFooter>
    </>
  );
}
