"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { engineeringApi, failureMessage } from "@/components/engineering/engineering-api";
import { PROJECT_3D_PLATFORM_API_ROOT } from "@/lib/3d/platform";
import { cn } from "@/lib/utils/cn";
import { GroupCard, SectionHeading } from "./rozaris-fields";

/*
 * The Rozaris editor's slot rename (SlotTabStrip) and "Building Anchor"
 * (UnitsPanel), saved on the model itself — they reach the viewer with the
 * next release, like every other model change.
 */

type Slot = { id: string; displayName: string; role: string; transformParentSlotId: string | null };

function useSlotUpdate(projectId: string) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function update(slotId: string, body: { displayName?: string; transformParentSlotId?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      await engineeringApi(`${PROJECT_3D_PLATFORM_API_ROOT}/projects/${projectId}/slots/${slotId}`, { method: "PATCH", body });
      router.refresh();
      return true;
    } catch (failure) {
      setError(failureMessage(failure, "The model could not be changed."));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, update };
}

/** A model's name in the Scene panel; select it to rename (double-click in Rozaris). */
export function SlotName({ projectId, slot, canEdit }: { projectId: string; slot: Slot; canEdit: boolean }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(slot.displayName);
  const { busy, error, update } = useSlotUpdate(projectId);

  async function commit() {
    const next = value.trim();
    if (next.length >= 2 && next !== slot.displayName && await update(slot.id, { displayName: next })) setEditing(false);
    else if (next === slot.displayName || next.length < 2) { setValue(slot.displayName); setEditing(false); }
  }

  if (!editing) {
    return (
      <button type="button" disabled={!canEdit} title={canEdit ? "Rename model" : undefined} onClick={() => { setValue(slot.displayName); setEditing(true); }} className="min-w-0 truncate text-left text-xs font-semibold text-fg-muted enabled:hover:text-fg">
        {slot.displayName}
      </button>
    );
  }
  return (
    <span className="min-w-0 flex-1">
      <input
        autoFocus
        aria-label="Rename model"
        value={value}
        maxLength={120}
        disabled={busy}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { setValue(slot.displayName); setEditing(false); }
        }}
        className="w-full rounded border border-line-strong bg-surface px-1.5 py-0.5 text-xs text-fg"
      />
      {error ? <span role="alert" className="block text-[10px] text-danger-strong">{error}</span> : null}
    </span>
  );
}

/** "Building Anchor" for each units model: the model its blocks follow when it moves. */
export function SlotAnchorPanel({ projectId, slots, canEdit }: { projectId: string; slots: Slot[]; canEdit: boolean }) {
  const { busy, error, update } = useSlotUpdate(projectId);
  const unitsSlots = slots.filter((slot) => slot.role === "UNITS");
  return (
    <div className="space-y-2">
      <SectionHeading>Asset</SectionHeading>
      <GroupCard>
        {unitsSlots.length === 0 ? <p className="text-[11px] text-fg-subtle">No units model yet — upload one on the Scene tab with the purpose &ldquo;Units (Unit_&lt;code&gt; blocks)&rdquo;.</p> : null}
        {unitsSlots.map((slot) => (
          <label key={slot.id} className="flex items-center justify-between gap-2 px-0.5 py-1 text-[11px] text-fg-muted">
            <span className="min-w-0 truncate">{unitsSlots.length > 1 ? `${slot.displayName} · ` : ""}Building Anchor</span>
            <select
              value={slot.transformParentSlotId ?? ""}
              disabled={!canEdit || busy}
              onChange={(event) => void update(slot.id, { transformParentSlotId: event.target.value || null })}
              className={cn("max-w-[160px] rounded border bg-surface px-1.5 py-0.5 text-[11px] text-fg", slot.transformParentSlotId ? "border-line-strong" : "border-warning/60")}
            >
              <option value="">— none —</option>
              {slots.filter((other) => other.id !== slot.id).map((other) => <option key={other.id} value={other.id}>{other.displayName}{other.role === "BUILDING" ? " (building)" : ""}</option>)}
            </select>
          </label>
        ))}
        {error ? <p role="alert" className="text-[10px] text-danger-strong">{error}</p> : null}
      </GroupCard>
      {unitsSlots.length ? <p className="px-0.5 text-[11px] text-fg-subtle">The unit blocks move, rotate and scale with their anchor, so they stay on the building when it is aligned.</p> : null}
    </div>
  );
}
