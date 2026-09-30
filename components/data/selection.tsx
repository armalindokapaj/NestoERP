"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { allVisibleSelected, pruneToVisible, selectAll, selectionSurvivesQueryChange, toggleId } from "@/lib/data/selection";

/**
 * Phone selection mode and bulk actions (MOB-03 §30-§33).
 *
 * Checkboxes are not on every card. A person taps Select, ticks records, acts,
 * and taps Done. Selection is by canonical record id and it is deterministic:
 * any change to the query (search, a filter, sort, page) clears it, so no
 * record stays selected that the person can no longer see. A workspace change
 * remounts the page, which starts a fresh provider.
 *
 * `DataTable selectable={{ actions }}` mounts the provider, the checkboxes and
 * the bar. Bulk actions are children of the bar that read `useSelection()`;
 * the server still authorizes each record when the action runs, so a hidden or
 * stale selection can never widen what is changed.
 */
type SelectionContextValue = {
  active: boolean;
  ids: ReadonlySet<string>;
  visibleIds: readonly string[];
  setActive: (active: boolean) => void;
  toggle: (id: string) => void;
  selectAllVisible: () => void;
  clear: () => void;
};

const SelectionContext = React.createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
  const value = React.useContext(SelectionContext);
  if (!value) throw new Error("useSelection must be used inside a SelectionProvider (DataTable selectable).");
  return value;
}

export function SelectionProvider({ visibleIds, children }: { visibleIds: readonly string[]; children: React.ReactNode }) {
  const [active, setActiveState] = React.useState(false);
  const [ids, setIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const query = useSearchParams().toString();

  // Any change to what the list shows drops the selection (§31).
  const lastQuery = React.useRef(query);
  React.useEffect(() => {
    const survives = selectionSurvivesQueryChange(lastQuery.current, query);
    lastQuery.current = query;
    if (!survives) setIds(new Set());
  }, [query]);

  // A record that left the visible page (refresh, sync) is no longer selected.
  React.useEffect(() => {
    setIds((current) => pruneToVisible(current, visibleIds));
  }, [visibleIds]);

  const value = React.useMemo<SelectionContextValue>(
    () => ({
      active,
      ids,
      visibleIds,
      setActive: (next) => {
        setActiveState(next);
        if (!next) setIds(new Set());
      },
      toggle: (id) => setIds((current) => toggleId(current, id)),
      selectAllVisible: () => setIds(selectAll(visibleIds)),
      clear: () => setIds(new Set()),
    }),
    [active, ids, visibleIds],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** The Select / Done toggle. Phones only: the desktop table has no selection column. */
export function SelectModeToggle({ className }: { className?: string }) {
  const t = useTranslations("ui");
  const { active, setActive } = useSelection();
  return (
    <div className={className}>
      <Button type="button" variant="secondary" size="sm" aria-pressed={active} onClick={() => setActive(!active)} data-testid="select-mode-toggle">
        {active ? t("doneSelecting") : t("select")}
      </Button>
    </div>
  );
}

/** One record's tick box; nothing at all outside selection mode. */
export function SelectRecordCheckbox({ id, name }: { id: string; name: string }) {
  const t = useTranslations("ui");
  const { active, ids, toggle } = useSelection();
  if (!active) return null;
  return (
    <span className="grid size-11 place-items-center">
      <Checkbox checked={ids.has(id)} onCheckedChange={() => toggle(id)} aria-label={t("selectRecord", { name })} data-testid="select-record" />
    </span>
  );
}

/**
 * The bar under a selection: the count, select-all and clear, then the bulk
 * actions. It is a sticky bottom action bar, so the bottom navigation steps
 * aside while it is up (MOB-02 §14, MOB-03 §79). Phones only.
 */
export function SelectionBar({ children }: { children?: React.ReactNode }) {
  const t = useTranslations("ui");
  const { active, ids, visibleIds, selectAllVisible, clear } = useSelection();
  if (!active) return null;
  const allSelected = allVisibleSelected(ids, visibleIds);
  return (
    <>
      <div aria-hidden="true" className="h-24 md:hidden" />
      <div
        data-sticky-action-bar
        data-testid="selection-bar"
        role="region"
        aria-label={t("selectedCount", { count: ids.size })}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pt-3 pb-[calc(0.75rem+var(--nesto-safe-bottom))] shadow-menu md:hidden"
      >
        <div className="mx-auto flex max-w-xl flex-wrap items-center gap-2">
          <p className="mr-auto text-table font-medium text-fg" aria-live="polite" data-testid="selection-count">
            {t("selectedCount", { count: ids.size })}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={allSelected ? clear : selectAllVisible}>
            {allSelected ? t("clearSelection") : t("selectAllVisible")}
          </Button>
          {children}
        </div>
      </div>
    </>
  );
}

/**
 * A bulk action. It is disabled with nothing selected, asks first when
 * `confirm` is given (always give it for anything destructive), runs on the
 * selected ids, and clears the selection when it succeeds. A failure keeps the
 * selection and says so; the server decides per record what is allowed.
 */
export function BulkAction({
  label,
  run,
  destructive = false,
  confirm,
  variant,
}: {
  label: string;
  run: (ids: string[]) => Promise<void> | void;
  destructive?: boolean;
  confirm?: { title: (count: number) => string; description: string; confirmLabel?: string };
  variant?: "primary" | "secondary" | "danger";
}) {
  const t = useTranslations("ui");
  const toast = useToast();
  const { ids, clear } = useSelection();
  const [asking, setAsking] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const inFlight = React.useRef(false);

  async function execute() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await run([...ids]);
      clear();
      setAsking(false);
    } catch (error) {
      toast({ title: error instanceof Error && error.message ? error.message : t("errorTitle"), tone: "danger" });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variant ?? (destructive ? "danger" : "secondary")}
        disabled={ids.size === 0 || pending}
        loading={pending && !asking}
        onClick={() => (confirm ? setAsking(true) : void execute())}
      >
        {label}
      </Button>
      {confirm ? (
        <ConfirmDialog
          open={asking}
          onOpenChange={setAsking}
          title={confirm.title(ids.size)}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel ?? label}
          destructive={destructive}
          pending={pending}
          onConfirm={() => void execute()}
        />
      ) : null}
    </>
  );
}
