"use client";

import * as React from "react";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { COMMITTED, failureOutcome, INVALID } from "@/components/project-planning/use-values-editor";
import { selectClass } from "@/components/forms/record-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import { UNIT_TYPE_CATEGORIES, UNIT_TYPE_CODE_MAX, UNIT_TYPE_NAME_MAX, type UnitTypeCategory } from "@/config/unit-types";
import type { UnitTypeDTO } from "@/lib/modules/project-structure/unit-type.service";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { cn } from "@/lib/utils/cn";
import { planFocusAfterRemoval } from "@/components/modules/focus-after-removal";

/**
 * The company's list of unit types (E-05B §20, §21, §116).
 *
 * The project types manager's twin, with two more things to keep: a short code
 * an import can map to, and the category that decides which details a unit of
 * the type is asked for. A type no unit has can be deleted; one in use is
 * retired, so no unit loses the type it was given.
 */

type Editing = { id: string; name: string; code: string; category: UnitTypeCategory; error: string | null };

function CategorySelect({ id, value, onChange, label }: { id: string; value: UnitTypeCategory; onChange: (value: UnitTypeCategory) => void; label?: string }) {
  const t = useTranslations("projects");
  return (
    <select id={id} aria-label={label} className={cn(selectClass, "sm:w-40")} value={value} onChange={(event) => onChange(event.target.value as UnitTypeCategory)}>
      {UNIT_TYPE_CATEGORIES.map((category) => (
        <option key={category} value={category}>
          {t(`unitCategory.${category}`)}
        </option>
      ))}
    </select>
  );
}

export function UnitTypesManager({ initial }: { initial: UnitTypeDTO[] }) {
  const toast = useToast();
  const t = useTranslations("projects");
  const [types, setTypes] = React.useState(initial);
  const [draft, setDraft] = React.useState<{ name: string; code: string; category: UnitTypeCategory }>({ name: "", code: "", category: "RESIDENTIAL" });
  const [addError, setAddError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<UnitTypeDTO | null>(null);

  const replace = (next: UnitTypeDTO) => setTypes((current) => current.map((type) => (type.id === next.id ? next : type)));

  // The type being added and the one being edited are both unsaved input
  // (AUD-03 §3): leaving asks, and Save and continue runs the same add or
  // save as the buttons. The category a new type starts on is kept after an
  // add, so that is the baseline, not input.
  const [draftCategory, setDraftCategory] = React.useState<UnitTypeCategory>("RESIDENTIAL");
  const adding = useUnsavedEditor({ module: "units", saveKind: "create", label: t("unitTypes.newLabel"), save: () => add() });
  const editor = useUnsavedEditor({ module: "units", saveKind: "save", label: () => t("unitTypes.editorLabel", { name: types.find((type) => type.id === editing?.id)?.name ?? "" }).trim(), save: () => save() });
  const setAddingDirty = adding.setDirty;
  const setEditorDirty = editor.setDirty;
  React.useEffect(() => setAddingDirty(draft.name !== "" || draft.code !== "" || draft.category !== draftCategory), [draft, draftCategory, setAddingDirty]);
  React.useEffect(() => {
    const original = editing ? types.find((type) => type.id === editing.id) : undefined;
    setEditorDirty(editing !== null && (!original || editing.name !== original.name || editing.code !== original.code || editing.category !== original.category));
  }, [editing, types, setEditorDirty]);

  async function add(): Promise<SaveOutcome> {
    if (!draft.name.trim()) {
      setAddError(t("types.nameRequired"));
      return INVALID;
    }
    setPending("add");
    adding.setSaving(true);
    setAddError(null);
    try {
      const created = await announcementApi<UnitTypeDTO>("/api/projects/unit-types", { body: { name: draft.name.trim(), code: draft.code.trim() || undefined, category: draft.category } });
      adding.setUnresolved(false);
      adding.setDirty(false);
      setTypes((current) => [...current, created]);
      setDraft({ name: "", code: "", category: draft.category });
      setDraftCategory(draft.category);
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

  async function save(): Promise<SaveOutcome> {
    if (!editing) return COMMITTED;
    setPending(editing.id);
    editor.setSaving(true);
    try {
      replace(await announcementApi<UnitTypeDTO>(`/api/projects/unit-types/${editing.id}`, { method: "PATCH", body: { name: editing.name.trim(), code: editing.code.trim() || undefined, category: editing.category } }));
      editor.setUnresolved(false);
      editor.setDirty(false);
      setEditing(null);
      return COMMITTED;
    } catch (error) {
      const outcome = failureOutcome(error);
      editor.setUnresolved(outcome.kind === "unknown");
      setEditing({ ...editing, error: failureMessage(error, t("unitTypes.saveFailed")) });
      return outcome;
    } finally {
      setPending(null);
      editor.setSaving(false);
    }
  }

  /** Starting another edit, or Cancel, drops the one being typed: asked first. */
  const startEdit = (next: Editing | null) => void editor.requestDismiss(() => setEditing(next));

  async function setActive(type: UnitTypeDTO, isActive: boolean) {
    setPending(type.id);
    try {
      replace(await announcementApi<UnitTypeDTO>(`/api/projects/unit-types/${type.id}`, { method: "PATCH", body: { isActive } }));
      toast({ title: isActive ? t("unitTypes.reactivated", { name: type.name }) : t("unitTypes.retiredToast", { name: type.name }) });
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
      setTypes(await announcementApi<UnitTypeDTO[]>("/api/projects/unit-types/reorder", { body: { ids: next.map((type) => type.id) } }));
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
      await announcementApi(`/api/projects/unit-types/${deleteTarget.id}`, { method: "DELETE" });
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
        <p className="text-card font-semibold text-fg">{t("unitTypes.addHeading")}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input aria-label={t("unitTypes.name")} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={UNIT_TYPE_NAME_MAX} placeholder={t("unitTypes.namePlaceholder")} aria-invalid={Boolean(addError)} className="sm:max-w-xs" />
          <Input aria-label={t("unitTypes.code")} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })} maxLength={UNIT_TYPE_CODE_MAX} placeholder={t("unitTypes.codePlaceholder")} className="sm:w-44" />
          <CategorySelect id="new-unit-type-category" label={t("unitTypes.category")} value={draft.category} onChange={(category) => setDraft({ ...draft, category })} />
          <Button type="submit" disabled={pending === "add"}>
            <Plus aria-hidden="true" />
            {pending === "add" ? t("types.adding") : t("types.add")}
          </Button>
        </div>
        {addError ? (
          <p role="alert" className="text-meta text-danger-strong">
            {addError}
          </p>
        ) : null}
      </form>

      <section className="nesto-card p-0" aria-labelledby="unit-types-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="unit-types-heading" className="text-card font-semibold text-fg">
            {t("unitTypes.yours")}
          </h2>
          <p className="text-meta text-fg-subtle">
            {t("types.inUse", { count: inUse })}{types.length > inUse ? t("types.retiredCount", { count: types.length - inUse }) : ""}
          </p>
        </div>

        {types.length === 0 ? (
          <p className="px-5 py-8 text-center text-table text-fg-muted">{t("unitTypes.empty")}</p>
        ) : (
          <ol className="divide-y divide-line" data-testid="unit-types">
            {types.map((type, index) => {
              const busy = pending === type.id;
              const isEditing = editing?.id === type.id;
              return (
                <li key={type.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3" data-testid="unit-type" data-type-name={type.name}>
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
                        void save();
                      }}
                      className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center"
                    >
                      <Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value, error: null })} maxLength={UNIT_TYPE_NAME_MAX} aria-label={t("types.newNameFor", { name: type.name })} autoFocus className="sm:max-w-xs" />
                      <Input value={editing.code} onChange={(event) => setEditing({ ...editing, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""), error: null })} maxLength={UNIT_TYPE_CODE_MAX} aria-label={t("unitTypes.codeFor", { name: type.name })} className="sm:w-40" />
                      <CategorySelect id={`unit-type-category-${type.id}`} label={t("unitTypes.categoryFor", { name: type.name })} value={editing.category} onChange={(category) => setEditing({ ...editing, category, error: null })} />
                      <div className="flex gap-1.5">
                        <Button type="submit" size="sm" disabled={busy}>
                          {busy ? t("types.saving") : t("types.save")}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(null)} disabled={busy}>
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
                      <p className={cn("flex min-w-0 flex-wrap items-center gap-2 text-body font-medium", type.isActive ? "text-fg" : "text-fg-muted")}>
                        <span className="truncate">{type.name}</span>
                        <span className="text-meta font-normal text-fg-subtle">{type.code}</span>
                        <Badge>{t(`unitCategory.${type.category}`)}</Badge>
                        {type.isActive ? null : <Badge>{t("types.retired")}</Badge>}
                      </p>
                      <p className="text-meta text-fg-subtle">{type.unitCount === 0 ? t("unitTypes.noUnits") : t("unitTypes.units", { count: type.unitCount })}</p>
                    </div>
                  )}

                  {isEditing ? null : (
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => startEdit({ id: type.id, name: type.name, code: type.code, category: type.category, error: null })} disabled={pending !== null}>
                        <Pencil aria-hidden="true" />
                        {t("mediaManager.edit")}<span className="sr-only"> {type.name}</span>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void setActive(type, !type.isActive)} disabled={pending !== null}>
                        {busy ? t("types.saving") : type.isActive ? t("types.retire") : t("types.useAgain")}
                        <span className="sr-only"> {type.name}</span>
                      </Button>
                      {type.unitCount === 0 ? (
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
        title={deleteTarget ? t("types.deleteTitle", { name: deleteTarget.name }) : t("unitTypes.deleteFallback")}
        description={t("unitTypes.deleteBody")}
        confirmLabel={t("types.deleteConfirm")}
        pending={deleteTarget !== null && pending === deleteTarget.id}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
