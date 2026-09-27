"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { COMMITTED, failureOutcome, INVALID } from "@/components/project-planning/use-values-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { PROJECT_TYPE_NAME_MAX } from "@/config/project-types";
import type { ProjectTypeDTO } from "@/lib/modules/projects/project.types";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { cn } from "@/lib/utils/cn";
import { planFocusAfterRemoval } from "@/components/modules/focus-after-removal";

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
  const t = useTranslations("projects");
  const [types, setTypes] = React.useState(initial);
  const [newName, setNewName] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; name: string; error: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectTypeDTO | null>(null);

  const replace = (next: ProjectTypeDTO) => setTypes((current) => current.map((type) => (type.id === next.id ? next : type)));

  // The name being added and the name being changed are both unsaved input
  // (AUD-03 §3): leaving asks, and Save and continue runs the same add or
  // rename as the buttons.
  const adding = useUnsavedEditor({ module: "projects", saveKind: "create", label: t("types.newLabel"), save: () => add() });
  const renaming = useUnsavedEditor({ module: "projects", saveKind: "save", label: () => t("types.nameOf", { name: types.find((type) => type.id === editing?.id)?.name ?? t("types.fallbackName") }), save: () => rename() });
  const setAddingDirty = adding.setDirty;
  const setRenamingDirty = renaming.setDirty;
  React.useEffect(() => setAddingDirty(newName !== ""), [newName, setAddingDirty]);
  React.useEffect(() => {
    const original = editing ? types.find((type) => type.id === editing.id)?.name : undefined;
    setRenamingDirty(editing !== null && editing.name !== original);
  }, [editing, types, setRenamingDirty]);

  async function add(): Promise<SaveOutcome> {
    const name = newName.trim();
    if (!name) {
      setAddError(t("types.nameRequired"));
      return INVALID;
    }
    setPending("add");
    adding.setSaving(true);
    setAddError(null);
    try {
      const created = await announcementApi<ProjectTypeDTO>("/api/projects/types", { body: { name } });
      adding.setUnresolved(false);
      adding.setDirty(false);
      setTypes((current) => [...current, created]);
      setNewName("");
      return COMMITTED;
    } catch (error) {
      const outcome = failureOutcome(error);
      adding.setUnresolved(outcome.kind === "unknown");
      setAddError(failureMessage(error, t("types.addFailed")));
      return outcome;
    } finally {
      setPending(null);
      adding.setSaving(false);
    }
  }

  async function rename(): Promise<SaveOutcome> {
    if (!editing) return COMMITTED;
    const name = editing.name.trim();
    const current = types.find((type) => type.id === editing.id);
    if (!current || name === current.name) {
      renaming.setDirty(false);
      setEditing(null);
      return COMMITTED;
    }
    setPending(editing.id);
    renaming.setSaving(true);
    try {
      replace(await announcementApi<ProjectTypeDTO>(`/api/projects/types/${editing.id}`, { method: "PATCH", body: { name } }));
      renaming.setUnresolved(false);
      renaming.setDirty(false);
      setEditing(null);
      return COMMITTED;
    } catch (error) {
      const outcome = failureOutcome(error);
      renaming.setUnresolved(outcome.kind === "unknown");
      setEditing({ ...editing, error: failureMessage(error, t("types.renameFailed")) });
      return outcome;
    } finally {
      setPending(null);
      renaming.setSaving(false);
    }
  }

  /** Starting another rename, or Cancel, drops the one being typed: asked first. */
  const startRename = (next: { id: string; name: string; error: null } | null) => void renaming.requestDismiss(() => setEditing(next));

  async function setActive(type: ProjectTypeDTO, isActive: boolean) {
    setPending(type.id);
    try {
      replace(await announcementApi<ProjectTypeDTO>(`/api/projects/types/${type.id}`, { method: "PATCH", body: { isActive } }));
      toast({ title: isActive ? t("types.reactivated", { name: type.name }) : t("types.retiredToast", { name: type.name }) });
    } catch (error) {
      toast({ title: failureMessage(error, t("types.changeFailed")), tone: "danger" });
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
      toast({ title: failureMessage(error, t("types.orderFailed")), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  // Focus goes to the next type, not <body>, once a row is deleted (AUD-11 §4, AV-04).
  const refocus = React.useRef<(() => void) | null>(null);

  async function remove() {
    if (!deleteTarget) return;
    setPending(deleteTarget.id);
    try {
      await announcementApi(`/api/projects/types/${deleteTarget.id}`, { method: "DELETE" });
      setTypes((current) => current.filter((type) => type.id !== deleteTarget.id));
      setDeleteTarget(null);
      refocus.current?.();
    } catch (error) {
      toast({ title: failureMessage(error, t("types.deleteFailed")), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  const inUse = types.filter((type) => type.isActive).length;

  return (
    <div className="space-y-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
        className="nesto-card space-y-2 p-5"
      >
        <label htmlFor="new-project-type" className="text-card font-semibold text-fg">
          {t("types.addHeading")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-project-type"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={PROJECT_TYPE_NAME_MAX}
            placeholder={t("types.placeholder")}
            aria-invalid={Boolean(addError)}
            aria-describedby={addError ? "new-project-type-error" : undefined}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={pending === "add"}>
            <Plus aria-hidden="true" />
            {pending === "add" ? t("types.adding") : t("types.add")}
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
            {t("types.yours")}
          </h2>
          <p className="text-meta text-fg-subtle">
            {t("types.inUse", { count: inUse })}{types.length > inUse ? t("types.retiredCount", { count: types.length - inUse }) : ""}
          </p>
        </div>

        {types.length === 0 ? (
          <p className="px-5 py-8 text-center text-table text-fg-muted">{t("types.empty")}</p>
        ) : (
          <ol className="divide-y divide-line" data-testid="project-types">
            {types.map((type, index) => {
              const busy = pending === type.id;
              const isEditing = editing?.id === type.id;
              return (
                <li key={type.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3" data-testid="project-type" data-type-name={type.name}>
                  <div className="flex shrink-0 items-center">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("types.moveUp", { name: type.name })} disabled={index === 0 || pending !== null} onClick={() => void move(index, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("types.moveDown", { name: type.name })} disabled={index === types.length - 1 || pending !== null} onClick={() => void move(index, 1)}>
                      <ArrowDown />
                    </Button>
                  </div>

                  {isEditing ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void rename();
                      }}
                      className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center"
                    >
                      <Input
                        value={editing.name}
                        onChange={(event) => setEditing({ ...editing, name: event.target.value, error: null })}
                        maxLength={PROJECT_TYPE_NAME_MAX}
                        aria-label={t("types.newNameFor", { name: type.name })}
                        aria-invalid={Boolean(editing.error)}
                        autoFocus
                        className="sm:max-w-xs"
                      />
                      <div className="flex gap-1.5">
                        <Button type="submit" size="sm" disabled={busy}>
                          {busy ? t("types.saving") : t("types.save")}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => startRename(null)} disabled={busy}>
                          {t("types.cancel")}
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
                        {type.isActive ? null : <Badge>{t("types.retired")}</Badge>}
                      </p>
                      <p className="text-meta text-fg-subtle">
                        {type.projectCount === 0 ? t("types.noProjects") : t("portfolio.count", { count: type.projectCount })}
                      </p>
                    </div>
                  )}

                  {isEditing ? null : (
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => startRename({ id: type.id, name: type.name, error: null })} disabled={pending !== null}>
                        <Pencil aria-hidden="true" />
                        {t("types.rename")}<span className="sr-only"> {type.name}</span>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void setActive(type, !type.isActive)} disabled={pending !== null}>
                        {busy ? t("types.saving") : type.isActive ? t("types.retire") : t("types.useAgain")}
                        <span className="sr-only"> {type.name}</span>
                      </Button>
                      {type.projectCount === 0 ? (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("types.delete", { name: type.name })} onClick={(event) => {
                          refocus.current = planFocusAfterRemoval(event.currentTarget);
                          setDeleteTarget(type);
                        }} disabled={pending !== null}>
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
        title={deleteTarget ? t("types.deleteTitle", { name: deleteTarget.name }) : t("types.deleteFallback")}
        description={t("types.deleteBody")}
        confirmLabel={t("types.deleteConfirm")}
        pending={deleteTarget !== null && pending === deleteTarget.id}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
