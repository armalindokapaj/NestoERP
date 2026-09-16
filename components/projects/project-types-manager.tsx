"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PROJECT_TYPE_NAME_MAX } from "@/config/project-types";
import type { ProjectTypeDTO } from "@/lib/modules/projects/project.types";
import { cn } from "@/lib/utils/cn";

/**
 * The company's list of project types (E-05A §30, §62).
 *
 * Add, rename, order, retire and bring back. A type no project has ever used
 * can be deleted; one in use can only be retired, so no project loses the type
 * it was given. The server decides every change — this keeps the list the
 * person is looking at in step with what it answered.
 */
export function ProjectTypesManager({ initial }: { initial: ProjectTypeDTO[] }) {
  const toast = useToast();
  const [types, setTypes] = React.useState(initial);
  const [newName, setNewName] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; name: string; error: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectTypeDTO | null>(null);

  const replace = (next: ProjectTypeDTO) => setTypes((current) => current.map((type) => (type.id === next.id ? next : type)));

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) {
      setAddError("Give the type a name.");
      return;
    }
    setPending("add");
    setAddError(null);
    try {
      const created = await announcementApi<ProjectTypeDTO>("/api/projects/types", { body: { name } });
      setTypes((current) => [...current, created]);
      setNewName("");
    } catch (error) {
      setAddError(failureMessage(error, "The type could not be added."));
    } finally {
      setPending(null);
    }
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    const current = types.find((type) => type.id === editing.id);
    if (!current || name === current.name) {
      setEditing(null);
      return;
    }
    setPending(editing.id);
    try {
      replace(await announcementApi<ProjectTypeDTO>(`/api/projects/types/${editing.id}`, { method: "PATCH", body: { name } }));
      setEditing(null);
    } catch (error) {
      setEditing({ ...editing, error: failureMessage(error, "The type could not be renamed.") });
    } finally {
      setPending(null);
    }
  }

  async function setActive(type: ProjectTypeDTO, isActive: boolean) {
    setPending(type.id);
    try {
      replace(await announcementApi<ProjectTypeDTO>(`/api/projects/types/${type.id}`, { method: "PATCH", body: { isActive } }));
      toast({ title: isActive ? `${type.name} is offered for projects again.` : `${type.name} is retired. Projects that have it keep it.` });
    } catch (error) {
      toast({ title: failureMessage(error, "The type could not be changed."), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  async function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= types.length) return;
    const previous = types;
    const next = [...types];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setTypes(next);
    setPending("reorder");
    try {
      setTypes(await announcementApi<ProjectTypeDTO[]>("/api/projects/types/reorder", { body: { ids: next.map((type) => type.id) } }));
    } catch (error) {
      setTypes(previous);
      toast({ title: failureMessage(error, "The order could not be saved."), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setPending(deleteTarget.id);
    try {
      await announcementApi(`/api/projects/types/${deleteTarget.id}`, { method: "DELETE" });
      setTypes((current) => current.filter((type) => type.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      toast({ title: failureMessage(error, "The type could not be deleted."), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  const inUse = types.filter((type) => type.isActive).length;

  return (
    <div className="space-y-5">
      <form onSubmit={add} className="nesto-card space-y-2 p-5">
        <label htmlFor="new-project-type" className="text-card font-semibold text-fg">
          Add a project type
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-project-type"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={PROJECT_TYPE_NAME_MAX}
            placeholder="For example Education"
            aria-invalid={Boolean(addError)}
            aria-describedby={addError ? "new-project-type-error" : undefined}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={pending === "add"}>
            <Plus aria-hidden="true" />
            {pending === "add" ? "Adding…" : "Add type"}
          </Button>
        </div>
        {addError ? (
          <p id="new-project-type-error" role="alert" className="text-meta text-danger-strong">
            {addError}
          </p>
        ) : null}
      </form>

      <section className="nesto-card p-0" aria-labelledby="project-types-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="project-types-heading" className="text-card font-semibold text-fg">
            Your project types
          </h2>
          <p className="text-meta text-fg-subtle">
            {inUse} in use{types.length > inUse ? ` · ${types.length - inUse} retired` : ""}
          </p>
        </div>

        {types.length === 0 ? (
          <p className="px-5 py-8 text-center text-table text-fg-muted">No project types yet. New projects need one — add the first above.</p>
        ) : (
          <ol className="divide-y divide-line" data-testid="project-types">
            {types.map((type, index) => {
              const busy = pending === type.id;
              const isEditing = editing?.id === type.id;
              return (
                <li key={type.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3" data-testid="project-type" data-type-name={type.name}>
                  <div className="flex shrink-0 items-center">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${type.name} up`} disabled={index === 0 || pending !== null} onClick={() => void move(index, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${type.name} down`} disabled={index === types.length - 1 || pending !== null} onClick={() => void move(index, 1)}>
                      <ArrowDown />
                    </Button>
                  </div>

                  {isEditing ? (
                    <form onSubmit={rename} className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center">
                      <Input
                        value={editing.name}
                        onChange={(event) => setEditing({ ...editing, name: event.target.value, error: null })}
                        maxLength={PROJECT_TYPE_NAME_MAX}
                        aria-label={`New name for ${type.name}`}
                        aria-invalid={Boolean(editing.error)}
                        autoFocus
                        className="sm:max-w-xs"
                      />
                      <div className="flex gap-1.5">
                        <Button type="submit" size="sm" disabled={busy}>
                          {busy ? "Saving…" : "Save"}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                          Cancel
                        </Button>
                      </div>
                      {editing.error ? (
                        <p role="alert" className="text-meta text-danger-strong sm:basis-full">
                          {editing.error}
                        </p>
                      ) : null}
                    </form>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className={cn("flex min-w-0 items-center gap-2 text-body font-medium", type.isActive ? "text-fg" : "text-fg-muted")}>
                        <span className="truncate">{type.name}</span>
                        {type.isActive ? null : <Badge>Retired</Badge>}
                      </p>
                      <p className="text-meta text-fg-subtle">
                        {type.projectCount === 0 ? "No projects" : `${type.projectCount} ${type.projectCount === 1 ? "project" : "projects"}`}
                      </p>
                    </div>
                  )}

                  {isEditing ? null : (
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing({ id: type.id, name: type.name, error: null })} disabled={pending !== null}>
                        <Pencil aria-hidden="true" />
                        Rename<span className="sr-only"> {type.name}</span>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void setActive(type, !type.isActive)} disabled={pending !== null}>
                        {busy ? "Saving…" : type.isActive ? "Retire" : "Use again"}
                        <span className="sr-only"> {type.name}</span>
                      </Button>
                      {type.projectCount === 0 ? (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${type.name}`} onClick={() => setDeleteTarget(type)} disabled={pending !== null}>
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete project type?"}
        description="No project uses this type, so nothing else changes. This cannot be undone."
        confirmLabel="Delete type"
        pending={deleteTarget !== null && pending === deleteTarget.id}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
