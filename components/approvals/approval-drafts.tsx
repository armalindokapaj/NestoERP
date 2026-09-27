"use client";

import * as React from "react";

/**
 * What a reviewer has typed into the review, held by the Approvals Center
 * rather than by the review itself (AUD-04 §3, MW-16).
 *
 * The review is shown in the side panel from 1024px and in a full-screen
 * sheet below it. Turning a tablet across that width moves the review from one
 * to the other, which mounts it again; a note, the open reason dialog and the
 * reason in it are read back from here, so nothing typed is lost to a
 * rotation. There is still one review and one set of values — never a phone
 * copy and a desktop copy of the same editor.
 *
 * Values live in memory only (never in storage, AUD-02 §7) and are keyed by
 * the approval: the shell forgets them when another approval, or none, is
 * selected, and the decision bar forgets a dialog's values when it closes, so
 * the next review starts clean exactly as before.
 */

type Store = Map<string, unknown>;

const DraftContext = React.createContext<Store | null>(null);

export function ApprovalDraftProvider({ store, children }: { store: Store; children: React.ReactNode }) {
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}

/** `useState`, remembered across a remount of the review. Without a provider it is plain `useState`. */
export function useApprovalDraft<T>(key: string, initial: T): [T, (next: T) => void] {
  const store = React.useContext(DraftContext);
  const [value, setValue] = React.useState<T>(() => (store?.has(key) ? (store.get(key) as T) : initial));
  const set = React.useCallback(
    (next: T) => {
      store?.set(key, next);
      setValue(next);
    },
    [store, key],
  );
  return [value, set];
}

/** Forgets the named drafts, so the next editor to read them starts clean. */
export function useForgetApprovalDrafts(): (...keys: string[]) => void {
  const store = React.useContext(DraftContext);
  return React.useCallback(
    (...keys: string[]) => {
      for (const key of keys) store?.delete(key);
    },
    [store],
  );
}
