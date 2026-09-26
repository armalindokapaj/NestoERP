"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Film, Image as ImageIcon, Star, Trash2, Upload } from "lucide-react";
import { useRouter } from "@/components/navigation/guarded-router";

import { useUploadQueue } from "@/components/documents/upload-queue";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { COMMITTED, useValuesEditor } from "@/components/project-planning/use-values-editor";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { outcomeOf } from "@/lib/unsaved/outcome";
import type { ProjectMediaCollection, ProjectMediaDTO } from "@/lib/modules/project-media/project-media.types";

type ApiEnvelope = { error?: { code?: string; message?: string; details?: { code?: string } } };

/** A refusal the server answered, as opposed to a request that never got an answer (AUD-03 §6). */
class Refusal extends Error {
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

async function request(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as ApiEnvelope;
  if (!response.ok) throw new Refusal(body.error?.message ?? "The change could not be saved.", body.error?.details?.code ?? body.error?.code);
}

export function ProjectMediaManager({ projectId, initial }: { projectId: string; initial: ProjectMediaCollection }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const uploadTypes = React.useRef(new WeakMap<File, "RENDER" | "ANIMATION">());
  const [uploadType, setUploadType] = React.useState<"RENDER" | "ANIMATION">("RENDER");
  const [editing, setEditing] = React.useState<ProjectMediaDTO | null>(null);
  const [removing, setRemoving] = React.useState<ProjectMediaDTO | null>(null);
  const [pending, setPending] = React.useState(false);

  const queue = useUploadQueue({
    parent: { context: "project", projectId },
    onUploaded: (documentId, file) => {
      const type = uploadTypes.current.get(file) ?? "RENDER";
      void request(`/api/projects/${projectId}/media`, {
        method: "POST",
        body: JSON.stringify({ documentId, type }),
      }).then(() => {
        toast({ title: `${type === "RENDER" ? "Render" : "Animation"} added.` });
        router.refresh();
      }).catch((error) => toast({ title: error instanceof Error ? error.message : "Media could not be linked.", tone: "danger" }));
    },
  });

  const items = [...initial.renders, ...initial.animations].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

  async function mutate(url: string, init: RequestInit, success: string): Promise<SaveOutcome> {
    setPending(true);
    try {
      await request(url, init);
      toast({ title: success });
      router.refresh();
      return COMMITTED;
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "The change could not be saved.", tone: "danger" });
      return error instanceof Refusal ? outcomeOf({ ok: false, code: error.code, error: error.message }) : { kind: "unknown" };
    } finally {
      setPending(false);
    }
  }

  async function move(index: number, step: number) {
    const next = [...items];
    const target = index + step;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await mutate(`/api/projects/${projectId}/media/reorder`, { method: "POST", body: JSON.stringify({ ids: next.map((item) => item.id) }) }, "Media order saved.");
  }

  return (
    <div className="space-y-6">
      {initial.capabilities.canUpload ? (
        <section className="nesto-card p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-table font-medium text-fg">
              Media type
              <select value={uploadType} onChange={(event) => setUploadType(event.target.value as "RENDER" | "ANIMATION")} className="h-9 rounded-md border border-line bg-surface px-3 text-body">
                <option value="RENDER">Render</option>
                <option value="ANIMATION">Animation</option>
              </select>
            </label>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={uploadType === "RENDER" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm,video/quicktime"}
              className="sr-only"
              aria-label={`Upload project ${uploadType === "RENDER" ? "renders" : "animations"}`}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                for (const file of files) uploadTypes.current.set(file, uploadType);
                if (files.length) queue.enqueue(files, (file) => ({ name: file.name.replace(/\.[^.]+$/, "") }));
                event.target.value = "";
              }}
            />
            <Button type="button" onClick={() => inputRef.current?.click()} disabled={queue.active}>
              <Upload aria-hidden="true" /> {queue.active ? "Uploading…" : `Upload ${uploadType === "RENDER" ? "renders" : "animations"}`}
            </Button>
          </div>
          {queue.items.length ? (
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
              {queue.items.map((item) => <li key={item.id} className="flex justify-between gap-3 px-3 py-2 text-table"><span className="truncate text-fg">{item.file.name}</span><span className="shrink-0 text-fg-muted">{item.status === "uploading" ? `${item.progress}%` : item.status}</span></li>)}
            </ul>
          ) : null}
        </section>
      ) : null}

      {items.length === 0 ? (
        <div className="nesto-card grid min-h-48 place-items-center p-6 text-center">
          <div><ImageIcon className="mx-auto size-7 text-fg-subtle" aria-hidden="true" /><p className="mt-2 text-body text-fg-muted">No project media yet.</p></div>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Project media">
          {items.map((item, index) => (
            <li key={item.id} className="nesto-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
              <div className="h-24 w-full shrink-0 overflow-hidden rounded-lg bg-surface-muted sm:w-36">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated project media endpoint.
                  <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : <span className="grid h-full place-items-center"><Film className="size-6 text-fg-subtle" aria-hidden="true" /></span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-2 py-1 text-meta font-medium text-fg-muted">{item.type === "RENDER" ? "Render" : "Animation"}</span>
                  {item.isCover ? <span className="inline-flex items-center gap-1 text-meta font-medium text-accent-strong"><Star className="size-3 fill-current" /> Cover</span> : null}
                  {item.isFeatured ? <span className="text-meta text-fg-muted">Featured</span> : null}
                </div>
                <p className="mt-1 truncate font-medium text-fg">{item.title}</p>
                <p className="truncate text-meta text-fg-subtle">{item.document.name}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>Edit</Button>
                {item.type === "RENDER" && !item.isCover ? <Button size="sm" variant="secondary" disabled={pending} onClick={() => void mutate(`/api/projects/${projectId}/media/${item.id}`, { method: "PATCH", body: JSON.stringify({ isCover: true }) }, "Project cover changed.")}><Star />Set cover</Button> : null}
                <Button size="icon-sm" variant="ghost" aria-label={`Move ${item.title} earlier`} disabled={pending || index === 0} onClick={() => void move(index, -1)}><ArrowUp /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Move ${item.title} later`} disabled={pending || index === items.length - 1} onClick={() => void move(index, 1)}><ArrowDown /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${item.title}`} disabled={pending} onClick={() => setRemoving(item)}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EditMediaDialog item={editing} renders={initial.renders} pending={pending} onClose={() => setEditing(null)} onSave={(body) => mutate(`/api/projects/${projectId}/media/${editing!.id}`, { method: "PATCH", body: JSON.stringify(body) }, "Media details saved.")} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.title ?? "media"}?`}
        description="It will disappear from the Project workspace. The canonical file remains in Documents."
        confirmLabel="Remove"
        pending={pending}
        onConfirm={() => void mutate(`/api/projects/${projectId}/media/${removing!.id}`, { method: "DELETE" }, "Media removed.").then((outcome) => outcome.kind === "committed" && setRemoving(null))}
      />
    </div>
  );
}

function EditMediaDialog({ item, renders, pending, onClose, onSave }: { item: ProjectMediaDTO | null; renders: ProjectMediaDTO[]; pending: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<SaveOutcome> }) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Edit project media</DialogTitle>
        <DialogDescription>Presentation details for this Project workspace.</DialogDescription>
        {item ? <EditMediaForm item={item} renders={renders} pending={pending} onSave={onSave} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mounted per item being edited, and registered with the tab's unsaved-work
 * coordinator (AUD-03 §5): closing with changes asks, and Save and continue
 * runs the same save as the Save button.
 */
function EditMediaForm({ item, renders, pending, onSave, onClose }: { item: ProjectMediaDTO; renders: ProjectMediaDTO[]; pending: boolean; onSave: (body: Record<string, unknown>) => Promise<SaveOutcome>; onClose: () => void }) {
  const [title, setTitle] = React.useState(item.title);
  const [description, setDescription] = React.useState(item.description ?? "");
  const [duration, setDuration] = React.useState(item.durationSeconds ? String(item.durationSeconds) : "");
  const [poster, setPoster] = React.useState(item.thumbnailDocumentId ?? "");
  const [featured, setFeatured] = React.useState(item.isFeatured);
  const persist = React.useRef<() => Promise<SaveOutcome>>(async () => COMMITTED);
  const editor = useValuesEditor({ title, description, duration, poster, featured }, { module: "projects", saveKind: "save", label: `Media ${item.title}`, save: () => persist.current() });
  const { setSaving, setUnresolved, rebaseline } = editor;

  persist.current = async () => {
    if (!title.trim()) return { kind: "invalid" };
    setSaving(true);
    const outcome = await onSave({ title: title.trim(), description: description.trim() || null, isFeatured: featured, ...(item.type === "ANIMATION" ? { durationSeconds: duration ? Number(duration) : null, thumbnailDocumentId: poster || null } : {}) });
    setSaving(false);
    setUnresolved(outcome.kind === "unknown");
    if (outcome.kind === "committed") {
      rebaseline();
      onClose();
    }
    return outcome;
  };

  return (
    <>
      <div className="mt-5 space-y-4">
        <label className="grid gap-1.5 text-table font-medium text-fg">Title<Input value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="grid gap-1.5 text-table font-medium text-fg">Description<textarea value={description} maxLength={2000} rows={3} onChange={(event) => setDescription(event.target.value)} className="rounded-md border border-line bg-surface px-3 py-2 text-body" /></label>
        {item.type === "ANIMATION" ? (
          <>
            <label className="grid gap-1.5 text-table font-medium text-fg">Duration in seconds<Input type="number" min={1} max={86400} value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
            <label className="grid gap-1.5 text-table font-medium text-fg">Poster image<select value={poster} onChange={(event) => setPoster(event.target.value)} className="h-9 rounded-md border border-line bg-surface px-3 text-body"><option value="">No poster</option>{renders.map((render) => <option key={render.id} value={render.document.id}>{render.title}</option>)}</select></label>
          </>
        ) : null}
        <label className="flex items-center gap-2 text-table text-fg"><input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} /> Featured on the Project page</label>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button disabled={pending || !title.trim()} onClick={() => void persist.current()}>Save</Button>
      </DialogFooter>
    </>
  );
}
