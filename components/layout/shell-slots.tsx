"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";

import { CriticalAnnouncementBanner } from "@/components/announcements/shell";
import { useTranslations } from "@/components/i18n/i18n-provider";
import type { CriticalBannerDTO } from "@/lib/modules/announcements/announcement.service";
import type { GroupEntryCapability, ShellCoreDTO } from "@/lib/workspace/shell-core";
import type { SlotResult } from "@/lib/workspace/shell-slots";
import type { WorkspacesDTO } from "@/lib/workspace/workspace.service";

/**
 * The shell's optional slots, in the browser (NAV-02 SHELL-01 to SHELL-05,
 * COMPAT-01, API-02, API-03).
 *
 * The server starts the workspace chooser's and the critical banner's reads
 * and hands them over as promises; the frame never waits for them. This host
 * settles them after hydration and owns what a slot may show:
 *
 * - the context key the answers must match — a new identity or workspace
 *   starts over from its own stream (SHELL-05, COMPAT-03);
 * - a generation per slot — an explicit Retry replaces the promise the slot
 *   reads, so a late first answer can no longer publish over it (S05);
 * - one retry at a time per slot, with a five-second deadline, and never an
 *   automatic one (API-02).
 *
 * The Group-entry capability comes out of the chooser's answer: record
 * navigation reads it from here and is never remounted or blocked while it is
 * pending (COMPAT-01, S07).
 *
 * Nothing here suspends. A Suspense boundary per slot in the streamed document
 * cost the page itself: React reveals server-rendered boundaries in batches, so
 * a slot that resolved first held the page's content back to the next batch —
 * measured, +13 to +20 % on the slowest document loads. None of a slot is
 * usable before hydration anyway, so it is settled after it.
 */

export type ShellSlotName = "workspaces" | "banner";

type SlotState<T> = { generation: number; promise: Promise<SlotResult<T>>; result?: SlotResult<T> };

type HostState = {
  key: string;
  workspaces: SlotState<WorkspacesDTO>;
  banner: SlotState<CriticalBannerDTO | null>;
};

type ShellSlotsValue = {
  core: ShellCoreDTO;
  workspaces: SlotState<WorkspacesDTO>;
  banner: SlotState<CriticalBannerDTO | null>;
  groupEntry: GroupEntryCapability;
  retry: (slot: ShellSlotName) => void;
  retrying: (slot: ShellSlotName) => boolean;
};

/** How long an unresolved slot waits before offering Retry, and how long a retry may take (SHELL-05, API-02). */
export const SLOT_RETRY_AFTER_MS = 5_000;
const ENDPOINT: Record<ShellSlotName, string> = { workspaces: "/api/shell/workspaces", banner: "/api/shell/critical-announcement" };

const ShellSlotsContext = React.createContext<ShellSlotsValue | null>(null);

function initialState(core: ShellCoreDTO, workspaces: Promise<SlotResult<WorkspacesDTO>>, banner: Promise<SlotResult<CriticalBannerDTO | null>>): HostState {
  return { key: core.contextKey, workspaces: { generation: 0, promise: workspaces }, banner: { generation: 0, promise: banner } };
}

export function ShellSlotsProvider({
  core,
  workspaces,
  banner,
  children,
}: {
  core: ShellCoreDTO;
  workspaces: Promise<SlotResult<WorkspacesDTO>>;
  banner: Promise<SlotResult<CriticalBannerDTO | null>>;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = React.useState(() => initialState(core, workspaces, banner));
  // A shell rendered for another context starts again from that context's own stream.
  if (state.key !== core.contextKey) setState(initialState(core, workspaces, banner));

  const keyRef = React.useRef(core.contextKey);
  keyRef.current = core.contextKey;
  const inFlight = React.useRef<Record<ShellSlotName, boolean>>({ workspaces: false, banner: false });
  const refreshedFor = React.useRef<Set<string>>(new Set());
  const [inFlightTick, rerender] = React.useReducer((count: number) => count + 1, 0);

  const current = state.key === core.contextKey ? state : initialState(core, workspaces, banner);

  // Each slot's current generation settles into its result; an answer for an
  // older generation, or for a context this shell has left, is dropped (S05, SHELL-05).
  React.useEffect(() => {
    const key = core.contextKey;
    let live = true;
    for (const slot of ["workspaces", "banner"] as const) {
      const { generation, promise, result } = current[slot];
      if (result) continue;
      void promise.then((settled) => {
        if (!live || keyRef.current !== key) return;
        setState((previous) =>
          previous.key !== key || previous[slot].generation !== generation ? previous : { ...previous, [slot]: { ...previous[slot], result: settled } },
        );
      });
    }
    return () => {
      live = false;
    };
  }, [current, core.contextKey]);

  // Group entry follows the chooser's answer. A failure is shown as
  // unavailable, never stored as a denial (COMPAT-01).
  const chooser = current.workspaces.result;
  const entry: GroupEntryCapability =
    core.groupEntry.status === "ready"
      ? core.groupEntry
      : !chooser
        ? { status: "pending" }
        : chooser.ok
          ? { status: "ready", canEnter: chooser.data.parentGroup.groupViewAllowed }
          : { status: "failed" };

  const retry = React.useCallback(
    (slot: ShellSlotName) => {
      if (inFlight.current[slot]) return;
      inFlight.current[slot] = true;
      rerender();
      const key = keyRef.current;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), SLOT_RETRY_AFTER_MS);
      const promise: Promise<SlotResult<never>> = fetch(ENDPOINT[slot], { signal: controller.signal, cache: "no-store", headers: { accept: "application/json" } })
        .then(async (response) => {
          if (!response.ok) return { ok: false } as const;
          const body = (await response.json()) as { data?: { contextKey?: string; workspaces?: WorkspacesDTO; banner?: CriticalBannerDTO | null } };
          if (body.data?.contextKey !== key) {
            // Drawn for a context this shell has left: never shown. The shell
            // is refreshed once for it, not on every mismatch (API-02).
            if (!refreshedFor.current.has(key)) {
              refreshedFor.current.add(key);
              router.refresh();
            }
            return { ok: false } as const;
          }
          return { ok: true, data: (slot === "workspaces" ? body.data.workspaces : (body.data.banner ?? null)) as never } as const;
        })
        .catch(() => ({ ok: false }) as const)
        .finally(() => {
          window.clearTimeout(timer);
          inFlight.current[slot] = false;
          rerender();
        });
      setState((previous) =>
        previous.key !== key ? previous : { ...previous, [slot]: { generation: previous[slot].generation + 1, promise } },
      );
    },
    [router],
  );

  const value = React.useMemo<ShellSlotsValue>(
    () => ({
      core,
      workspaces: current.workspaces,
      banner: current.banner,
      groupEntry: entry,
      retry,
      retrying: (slot) => inFlight.current[slot],
    }),
    // `inFlightTick` re-publishes the value when a retry starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [core, current.workspaces, current.banner, entry, retry, inFlightTick],
  );

  return <ShellSlotsContext.Provider value={value}>{children}</ShellSlotsContext.Provider>;
}

function useShellSlots(): ShellSlotsValue {
  const value = React.useContext(ShellSlotsContext);
  if (!value) throw new Error("A shell slot is rendered outside ShellSlotsProvider.");
  return value;
}

/** Whether the Group view can be entered from here, for record navigation (COMPAT-01). */
export function useGroupEntry(): GroupEntryCapability | null {
  return React.useContext(ShellSlotsContext)?.groupEntry ?? null;
}

/** Retry appears only once a slot has been unresolved for five seconds (SHELL-05); each generation starts its own five. */
function useOverdue(active: boolean, generation: number): boolean {
  const [overdueFor, setOverdueFor] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setOverdueFor(generation), SLOT_RETRY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [active, generation]);
  return active && overdueFor === generation;
}

/* -------------------------------------------------------------------------- */
/* Workspace slot                                                              */
/* -------------------------------------------------------------------------- */

/** The verified shell core: the active workspace, the organization and the context key (OW §57). */
export function useShellCore(): ShellCoreDTO {
  return useShellSlots().core;
}

export type WorkspaceOptionsState =
  | { status: "pending"; overdue: boolean }
  | { status: "failed" }
  | { status: "ready"; workspaces: WorkspacesDTO; total: number };

/** How many workspaces the chooser offers: the Group when it may be entered, and every company. */
export function workspaceTotal(list: WorkspacesDTO): number {
  return (list.parentGroup.groupViewAllowed ? 1 : 0) + list.companies.length + list.otherGroups.reduce((sum, group) => sum + group.companies.length, 0);
}

/**
 * The workspace chooser's options (SHELL-02, OW §57-§59). The sidebar header is
 * drawn from the verified core at once; only its popup waits for this list,
 * which streams with the shell and is never fetched again to open it. A
 * failure keeps the current workspace and offers Retry — only after five
 * seconds for a slot still loading (SHELL-05).
 */
export function useWorkspaceOptions(): { state: WorkspaceOptionsState; retry: () => void; retrying: boolean } {
  const { workspaces, retry, retrying } = useShellSlots();
  const result = workspaces.result;
  const overdue = useOverdue(!result, workspaces.generation);
  const state: WorkspaceOptionsState = !result
    ? { status: "pending", overdue }
    : result.ok
      ? { status: "ready", workspaces: result.data, total: workspaceTotal(result.data) }
      : { status: "failed" };
  return { state, retry: () => retry("workspaces"), retrying: retrying("workspaces") };
}

/* -------------------------------------------------------------------------- */
/* Banner slot                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The critical notice's place (SHELL-03): a region the height of the banner,
 * reserved at every width, so a banner arriving late pushes nothing under a
 * pointer. Loading and a legitimate "no banner" look the same — an empty
 * region, with nothing announced and no invented text. A failure is a quiet
 * note with Retry, never mistaken for "no announcements".
 */
export function BannerSlot() {
  const { banner } = useShellSlots();
  const result = banner.result;
  return (
    <div className="min-h-[var(--nesto-banner-height)]" data-testid="critical-banner-region">
      {result ? result.ok ? <CriticalAnnouncementBanner banner={result.data} /> : <BannerFailed /> : null}
    </div>
  );
}

function BannerFailed() {
  const t = useTranslations("shell");
  const { retry, retrying } = useShellSlots();
  return (
    <div className="flex min-h-[var(--nesto-banner-height)] items-center justify-end gap-2 px-4 text-meta text-fg-subtle md:px-6 xl:px-8" data-testid="critical-banner-failed">
      <span>{t("bannerCheckFailed")}</span>
      <button type="button" onClick={() => retry("banner")} disabled={retrying("banner")} className="rounded px-1.5 py-0.5 font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50" data-testid="critical-banner-retry">
        {t("bannerRetry")}
      </button>
    </div>
  );
}
