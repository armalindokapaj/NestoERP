"use client";

import { useSyncExternalStore } from "react";

import type { Currency, Locale, Unit } from "@/lib/3d/viewer/types";

/**
 * The slices of the Rozaris app store the Project viewer reads, and nothing
 * else: language, display currency, saved projects and the unit comparison.
 *
 * NESTO has no marketplace backend behind favourites or comparison, so both
 * stay in this browser (localStorage, best effort) exactly as a signed-out
 * Rozaris visitor's would. The language starts from the reader's NESTO choice.
 */

export const DEFAULT_EUR_TO_ALL_RATE = 97;

export type CompareEntity = { kind: "unit"; entity: Unit; projectName: string; projectSlug: string };

interface ViewerState {
  locale: Locale;
  currency: Currency;
  eurToAllRate: number;
  auth: { signedIn: boolean };
  saved: { projects: string[] };
  compare: CompareEntity[];
  compareReplaceCandidate: CompareEntity | null;
  compareOverlayOpen: boolean;
}

interface ViewerActions {
  setLocale: (locale: Locale) => void;
  setCurrency: (currency: Currency) => void;
  toggleSavedProject: (id: string) => void;
  addCompare: (item: CompareEntity) => void;
  removeCompareAt: (index: number) => void;
  confirmReplace: (index: number) => void;
  cancelReplace: () => void;
  setCompareOverlayOpen: (open: boolean) => void;
}

export type ViewerStore = ViewerState & ViewerActions;

const STORAGE_KEY = "nesto:project-viewer";

type Persisted = Pick<ViewerState, "currency" | "saved" | "compare">;

function readPersisted(): Partial<Persisted> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

function writePersisted(state: ViewerState) {
  try {
    const persisted: Persisted = { currency: state.currency, saved: state.saved, compare: state.compare };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Private windows and blocked storage: the choice lasts for this visit only.
  }
}

function initialLocale(): Locale {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang === "sq" ? "sq" : "en";
}

const listeners = new Set<() => void>();
let state: ViewerStore;

function setState(partial: Partial<ViewerState> | ((current: ViewerStore) => Partial<ViewerState>)) {
  const next = typeof partial === "function" ? partial(state) : partial;
  state = { ...state, ...next };
  writePersisted(state);
  listeners.forEach((listener) => listener());
}

function sameUnit(a: CompareEntity, b: CompareEntity) {
  return a.entity.id === b.entity.id;
}

function createInitialState(): ViewerStore {
  const persisted = typeof window === "undefined" ? {} : readPersisted();
  return {
    locale: initialLocale(),
    currency: persisted.currency === "ALL" ? "ALL" : "EUR",
    eurToAllRate: DEFAULT_EUR_TO_ALL_RATE,
    // Everyone who reaches the Company viewer is signed in to NESTO.
    auth: { signedIn: true },
    saved: { projects: Array.isArray(persisted.saved?.projects) ? persisted.saved.projects : [] },
    compare: Array.isArray(persisted.compare) ? persisted.compare.slice(0, 2) : [],
    compareReplaceCandidate: null,
    compareOverlayOpen: false,
    setLocale: (locale) => {
      // The viewer's language is the reader's NESTO language: the same cookie
      // the rest of NESTO reads, so the choice follows them out of the viewer.
      try {
        document.cookie = `nesto.locale=${locale}; path=/; max-age=31536000; samesite=lax`;
        document.documentElement.lang = locale;
      } catch {
        // Cookie writes can be blocked; the viewer still switches.
      }
      setState({ locale });
    },
    setCurrency: (currency) => setState({ currency }),
    toggleSavedProject: (id) =>
      setState((s) => ({
        saved: {
          projects: s.saved.projects.includes(id) ? s.saved.projects.filter((p) => p !== id) : [...s.saved.projects, id],
        },
      })),
    addCompare: (item) =>
      setState((s) => {
        if (s.compare.some((c) => sameUnit(c, item))) return {};
        return s.compare.length < 2 ? { compare: [...s.compare, item] } : { compareReplaceCandidate: item };
      }),
    removeCompareAt: (index) => setState((s) => ({ compare: s.compare.filter((_, i) => i !== index) })),
    confirmReplace: (index) =>
      setState((s) => {
        if (!s.compareReplaceCandidate) return {};
        const compare = [...s.compare];
        compare[index] = s.compareReplaceCandidate;
        return { compare, compareReplaceCandidate: null };
      }),
    cancelReplace: () => setState({ compareReplaceCandidate: null }),
    setCompareOverlayOpen: (compareOverlayOpen) => setState({ compareOverlayOpen }),
  };
}

state = createInitialState();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `useAppStore(selector)` from Rozaris, over this viewer-local store. */
export function useViewerStore<T>(selector: (s: ViewerStore) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

useViewerStore.getState = () => state;
