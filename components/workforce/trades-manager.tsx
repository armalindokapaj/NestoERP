"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";

import { announcementApi, failureMessage } from "@/components/announcements/announcement-api";
import { failureOutcome } from "@/components/engineering/engineering-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { TRADE_NAME_MAX, type TradeDTO } from "@/lib/modules/workforce/workforce.types";

import { cn } from "@/lib/utils/cn";
import { planFocusAfterRemoval } from "@/components/modules/focus-after-removal";

/**
 * The company's trades (E-04 §11): add, rename, order, retire and bring back.
 * A trade nobody has been given can be deleted; one in use can only be
 * retired, so no employee, crew or assignment loses the trade it was recorded
 * with. The server decides every change — this keeps the list in step with
 * what it answered.
 *
 * A name typed into "Add a trade", and a rename in progress, are two editors
 * (AUD-03 §3): leaving asks about each, and "Save and continue" runs its own
 * Add or Save. Cancel, or starting another rename, asks before dropping one.
 */
function usage(trade: TradeDTO): string {
  const parts = [
    trade.employeeCount ? `${trade.employeeCount} ${trade.employeeCount === 1 ? "employee" : "employees"}` : null,
    trade.crewCount ? `${trade.crewCount} ${trade.crewCount === 1 ? "crew" : "crews"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nobody yet";
}

export function TradesManager({ initial }: { initial: TradeDTO[] }) {
  const toast = useToast();
  const [trades, setTrades] = React.useState(initial);
  const [newName, setNewName] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; name: string; error: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<TradeDTO | null>(null);

  const replace = (next: TradeDTO) => setTrades((current) => current.map((type) => (type.id === next.id ? next : type)));

  const adding = useUnsavedEditor({ module: "workforce", saveKind: "create", label: "New trade", save: () => add() });
  const { setDirty: setAddingDirty, setSaving: setAddingSaving } = adding;
  React.useEffect(() => setAddingDirty(newName !== ""), [newName, setAddingDirty]);
  React.useEffect(() => setAddingSaving(pending === "add"), [pending, setAddingSaving]);

  const renamed = editing ? trades.find((type) => type.id === editing.id) : undefined;
  const renaming = useUnsavedEditor({ module: "workforce", saveKind: "save", label: renamed ? `Rename ${renamed.name}` : "Trade name", save: () => rename() });
  const { setDirty: setRenamingDirty, setSaving: setRenamingSaving } = renaming;
  React.useEffect(() => setRenamingDirty(Boolean(editing && renamed && editing.name !== renamed.name)), [editing, renamed, setRenamingDirty]);
  React.useEffect(() => setRenamingSaving(Boolean(editing && pending === editing.id)), [editing, pending, setRenamingSaving]);

  async function add(): Promise<SaveOutcome> {
    if (pending === "add") return { kind: "unknown" };
    const name = newName.trim();
    if (!name) {
      setAddError("Give the trade a name.");
      return { kind: "invalid" };
    }
    setPending("add");
    setAddError(null);
    try {
      const created = await announcementApi<TradeDTO>("/api/workforce/trades", { body: { name } });
      setTrades((current) => [...current, created]);
      adding.setDirty(false);
      setNewName("");
      return { kind: "committed" };
    } catch (error) {
      setAddError(failureMessage(error, "The trade could not be added."));
      return failureOutcome(error);
    } finally {
      setPending(null);
    }
  }

  async function rename(): Promise<SaveOutcome> {
    if (!editing) return { kind: "committed" };
    const name = editing.name.trim();
    const current = trades.find((type) => type.id === editing.id);
    if (!current || name === current.name) {
      renaming.setDirty(false);
      setEditing(null);
      return { kind: "committed" };
    }
    setPending(editing.id);
    try {
      replace(await announcementApi<TradeDTO>(`/api/workforce/trades/${editing.id}`, { method: "PATCH", body: { name } }));
      renaming.setDirty(false);
      setEditing(null);
      return { kind: "committed" };
    } catch (error) {
      setEditing({ ...editing, error: failureMessage(error, "The trade could not be renamed.") });
      return failureOutcome(error);
    } finally {
      setPending(null);
    }
  }

  /** Starts renaming a trade — asking first when another rename holds a change. */
  function startRename(type: TradeDTO) {
    void renaming.requestDismiss(() => setEditing({ id: type.id, name: type.name, error: null }));
  }

  async function setActive(type: TradeDTO, isActive: boolean) {
    setPending(type.id);
    try {
      replace(await announcementApi<TradeDTO>(`/api/workforce/trades/${type.id}`, { method: "PATCH", body: { isActive } }));
      toast({ title: isActive ? `${type.name} is offered again.` : `${type.name} is retired. Everybody who has it keeps it.` });
    } catch (error) {
      toast({ title: failureMessage(error, "The trade could not be changed."), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  async function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= trades.length) return;
    const previous = trades;
    const next = [...trades];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setTrades(next);
    setPending("reorder");
    try {
      setTrades(await announcementApi<TradeDTO[]>("/api/workforce/trades/reorder", { body: { ids: next.map((type) => type.id) } }));
    } catch (error) {
      setTrades(previous);
      toast({ title: failureMessage(error, "The order could not be saved."), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  // Focus goes to the next trade, not <body>, once a row is deleted (AUD-11 §4, AV-04).
  const refocus = React.useRef<(() => void) | null>(null);

  async function remove() {
    if (!deleteTarget) return;
    setPending(deleteTarget.id);
    try {
      await announcementApi(`/api/workforce/trades/${deleteTarget.id}`, { method: "DELETE" });
      setTrades((current) => current.filter((type) => type.id !== deleteTarget.id));
      setDeleteTarget(null);
      refocus.current?.();
    } catch (error) {
      toast({ title: failureMessage(error, "The trade could not be deleted."), tone: "danger" });
    } finally {
      setPending(null);
    }
  }

  const inUse = trades.filter((type) => type.isActive).length;

  return (
    <div className="space-y-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
        className="nesto-card space-y-2 p-5"
      >
        <label htmlFor="new-trade" className="text-card font-semibold text-fg">
          Add a trade
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-trade"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={TRADE_NAME_MAX}
            placeholder="For example Steel fixer"
            aria-invalid={Boolean(addError)}
            aria-describedby={addError ? "new-trade-error" : undefined}
            className="sm:max-w-sm"
          />
          <Button type="submit" disabled={pending === "add"}>
            <Plus aria-hidden="true" />
            {pending === "add" ? "Adding…" : "Add trade"}
          </Button>
        </div>
        {addError ? (
          <p id="new-trade-error" role="alert" className="text-meta text-danger-strong">
            {addError}
          </p>
        ) : null}
      </form>

      <section className="nesto-card p-0" aria-labelledby="trades-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 id="trades-heading" className="text-card font-semibold text-fg">
            Your trades
          </h2>
          <p className="text-meta text-fg-subtle">
            {inUse} in use{trades.length > inUse ? ` · ${trades.length - inUse} retired` : ""}
          </p>
        </div>

        {trades.length === 0 ? (
          <p className="px-5 py-8 text-center text-table text-fg-muted">No trades yet. Add the first above — workers, crews and assignments can then name one.</p>
        ) : (
          <ol className="divide-y divide-line" data-testid="trades">
            {trades.map((type, index) => {
              const busy = pending === type.id;
              const isEditing = editing?.id === type.id;
              return (
                <li key={type.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3" data-testid="trade" data-trade-name={type.name}>
                  <div className="flex shrink-0 items-center">
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${type.name} up`} disabled={index === 0 || pending !== null} onClick={() => void move(index, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${type.name} down`} disabled={index === trades.length - 1 || pending !== null} onClick={() => void move(index, 1)}>
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
                        maxLength={TRADE_NAME_MAX}
                        aria-label={`New name for ${type.name}`}
                        aria-invalid={Boolean(editing.error)}
                        autoFocus
                        className="sm:max-w-xs"
                      />
                      <div className="flex gap-1.5">
                        <Button type="submit" size="sm" disabled={busy}>
                          {busy ? "Saving…" : "Save"}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void renaming.requestDismiss(() => setEditing(null))} disabled={busy}>
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
                        {usage(type)}
                      </p>
                    </div>
                  )}

                  {isEditing ? null : (
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => startRename(type)} disabled={pending !== null}>
                        <Pencil aria-hidden="true" />
                        Rename<span className="sr-only"> {type.name}</span>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => void setActive(type, !type.isActive)} disabled={pending !== null}>
                        {busy ? "Saving…" : type.isActive ? "Retire" : "Use again"}
                        <span className="sr-only"> {type.name}</span>
                      </Button>
                      {type.employeeCount + type.crewCount === 0 ? (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${type.name}`} onClick={(event) => {
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
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete trade?"}
        description="Nobody has this trade, so nothing else changes. This cannot be undone."
        confirmLabel="Delete trade"
        pending={deleteTarget !== null && pending === deleteTarget.id}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
