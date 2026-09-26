"use client";

import * as React from "react";
import Link from "@/components/navigation/nav-link";
import { useRouter } from "@/components/navigation/guarded-router";
import { Link2, ListPlus, X } from "lucide-react";

import { selectClass } from "@/components/forms/record-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, useDialogClose } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { LINK_GROUPS, LINKABLE_LABELS, type LinkableType, type LinkedRecordDTO, type Option } from "@/lib/modules/engineering/engineering.types";
import { engineeringApi, failureMessage } from "./engineering-api";
import { FormDialog, RequestMessages, useRequestEditor, type FormField } from "./form-kit";

/**
 * What a record points at (PRD #46 §79, §111-§113, §133-§155). Tasks, meetings
 * and site logs; QA/QC and HSE records; purchase orders and contract
 * obligations — each opened through its own module, and linking changes none
 * of them. A new task is raised through the task service with this record as
 * its parent.
 */

const TASK_FIELDS = (assignees: Option[]): FormField[] => [
  { name: "title", label: "Title", type: "text", required: true, wide: true },
  { name: "assigneeMemberId", label: "Assignee", type: "select", options: assignees.map((item) => ({ value: item.id, label: item.label })) },
  { name: "dueDate", label: "Due", type: "date" },
  { name: "priority", label: "Priority", type: "select", required: true, options: [{ value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }, { value: "CRITICAL", label: "Critical" }] },
  { name: "description", label: "Description", type: "textarea", rows: 3 },
];

export function LinksPanel({
  apiBase,
  links,
  types,
  canLink,
  canCreateTask,
  assignees = [],
  title = "Linked records",
  description = "Work, quality, safety and commercial records this one refers to.",
  emptyText = "Nothing linked yet.",
}: {
  /** e.g. /api/work-packages/:id — `/links`, `/links/options` and `/tasks` hang off it. */
  apiBase: string;
  links: LinkedRecordDTO[];
  types: LinkableType[];
  canLink: boolean;
  canCreateTask: boolean;
  assignees?: Option[];
  title?: string;
  description?: string;
  emptyText?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [linking, setLinking] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);

  const grouped = LINK_GROUPS.map((group) => ({ ...group, rows: links.filter((link) => group.types.includes(link.type)) })).filter((group) => group.rows.length);

  async function remove(linkId: string) {
    setRemoving(linkId);
    try {
      await engineeringApi(`${apiBase}/links/${linkId}`, { method: "DELETE" });
      toast({ title: "Link removed.", tone: "success" });
      router.refresh();
    } catch (failure) {
      toast({ title: failureMessage(failure), tone: "danger" });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="nesto-card min-w-0 p-5" aria-labelledby={`${apiBase}-links`} data-testid="links-panel">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${apiBase}-links`} className="text-card font-semibold text-fg">
            {title}
          </h2>
          <p className="mt-0.5 text-table text-fg-muted">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreateTask ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(true)} data-testid="create-task">
              <ListPlus aria-hidden="true" />
              Create task
            </Button>
          ) : null}
          {canLink && types.length ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setLinking(true)} data-testid="link-record">
              <Link2 aria-hidden="true" />
              Link record
            </Button>
          ) : null}
        </div>
      </div>
      {grouped.length === 0 ? (
        <p className="text-table text-fg-muted">{emptyText}</p>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.label}>
              <h3 className="nesto-eyebrow mb-1.5 text-fg-subtle">{group.label}</h3>
              <ul className="divide-y divide-line rounded-md border border-line">
                {group.rows.map((link) => (
                  <li key={`${link.type}:${link.id}`} className="flex items-center justify-between gap-3 px-3 py-2" data-testid="linked-record">
                    <div className="min-w-0">
                      <span className="mr-2 text-meta text-fg-subtle">{link.typeLabel}</span>
                      <Link href={link.href} className="text-table text-fg underline-offset-4 hover:underline">
                        {link.label}
                      </Link>
                    </div>
                    {canLink && link.linkId ? (
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove link to ${link.label}`} disabled={removing === link.linkId} onClick={() => void remove(link.linkId)}>
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {linking ? <LinkDialog apiBase={apiBase} types={types} onClose={() => setLinking(false)} /> : null}
      {canCreateTask ? (
        <FormDialog
          open={creating}
          onOpenChange={setCreating}
          title="Create task"
          description="The task lives in Tasks, with this record as where it came from."
          fields={TASK_FIELDS(assignees)}
          initial={{ priority: "MEDIUM" }}
          submitLabel="Create task"
          module="engineering"
          testId="task-form"
          onSubmit={async (payload) => {
            await engineeringApi(`${apiBase}/tasks`, { body: payload });
            toast({ title: "Task created.", tone: "success" });
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function LinkDialog({ apiBase, types, onClose }: { apiBase: string; types: LinkableType[]; onClose: () => void }) {
  const [pending, setPending] = React.useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-w-lg" data-testid="link-dialog">
        <DialogTitle>Link a record</DialogTitle>
        <DialogDescription>Only records on the same project that you can open are offered.</DialogDescription>
        {/* Inside the dialog, so the pick belongs to its guarded close (AUD-03 §5). */}
        <LinkForm apiBase={apiBase} types={types} onClose={onClose} onPending={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({ apiBase, types, onClose, onPending }: { apiBase: string; types: LinkableType[]; onClose: () => void; onPending: (pending: boolean) => void }) {
  const router = useRouter();
  const toast = useToast();
  const close = useDialogClose();
  const [type, setType] = React.useState<LinkableType>(types[0]);
  const [options, setOptions] = React.useState<Option[] | null>(null);
  const [recordId, setRecordId] = React.useState("");

  React.useEffect(() => {
    let live = true;
    setOptions(null);
    setRecordId("");
    engineeringApi<Option[]>(`${apiBase}/links/options?type=${type}`)
      .then((rows) => live && setOptions(rows))
      .catch(() => live && setOptions([]));
    return () => {
      live = false;
    };
  }, [apiBase, type]);

  const save = useRequestEditor({
    module: "engineering",
    saveKind: "create",
    label: "Link a record",
    dirty: recordId !== "",
    request: () => engineeringApi(`${apiBase}/links`, { body: { type, recordId } }),
    onCommitted: () => {
      toast({ title: "Record linked.", tone: "success" });
      onClose();
      router.refresh();
    },
  });
  const { pending } = save;
  React.useEffect(() => onPending(pending), [onPending, pending]);

  return (
    <form onSubmit={save.onSubmit} className="mt-4 space-y-4">
      <fieldset disabled={pending} className="m-0 min-w-0 space-y-4 border-0 p-0">
        <div className="flex flex-col gap-1">
          <label htmlFor="link-type" className="text-meta font-medium text-fg-muted">
            Kind of record
          </label>
          <select id="link-type" className={selectClass} value={type} onChange={(event) => setType(event.target.value as LinkableType)}>
            {LINK_GROUPS.map((group) => {
              const available = group.types.filter((item) => types.includes(item));
              return available.length ? (
                <optgroup key={group.label} label={group.label}>
                  {available.map((item) => (
                    <option key={item} value={item}>
                      {LINKABLE_LABELS[item]}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="link-record" className="text-meta font-medium text-fg-muted">
            Record
          </label>
          <select id="link-record" className={selectClass} value={recordId} onChange={(event) => setRecordId(event.target.value)} disabled={options === null}>
            <option value="">{options === null ? "Loading…" : options.length ? "Choose a record" : "Nothing to link on this project"}</option>
            {(options ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </fieldset>
      <RequestMessages error={save.error} outcomeText={save.outcomeText} />
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !recordId}>
          {pending ? "Linking…" : "Link"}
        </Button>
      </DialogFooter>
    </form>
  );
}
