/**
 * The product's two live regions (AUD-11 §5, AV-09).
 *
 * One polite region for completed reads, result counts, selection and
 * confirmed success; one assertive region for errors that need attention now.
 * Both are rendered once, by `<LiveAnnouncer />` in the app shell, and stay
 * mounted, so a message is never lost to a region that appeared in the same
 * frame as its text.
 *
 * - Say it once. A toast is already announced by its own live copy; do not
 *   also announce the same words here.
 * - Say the outcome, not every keystroke: announce a result count when a
 *   search settles, never on each character.
 * - Never announce data the reader could not see on the page.
 *
 * The same message repeated inside `REPEAT_WINDOW_MS` is dropped; a repeat
 * after that is re-announced (the region is cleared first so assistive
 * technology notices the change).
 */
export type Politeness = "polite" | "assertive";

export type AnnouncerState = Readonly<Record<Politeness, { message: string; id: number }>>;

export const REPEAT_WINDOW_MS = 1000;

type Listener = () => void;

let state: AnnouncerState = { polite: { message: "", id: 0 }, assertive: { message: "", id: 0 } };
const lastSaid: Record<Politeness, { message: string; at: number }> = {
  polite: { message: "", at: -Infinity },
  assertive: { message: "", at: -Infinity },
};
const listeners = new Set<Listener>();
let nextId = 1;

export function announce(message: string, politeness: Politeness = "polite", now: number = Date.now()): boolean {
  const text = message.trim();
  if (!text) return false;
  const last = lastSaid[politeness];
  if (last.message === text && now - last.at < REPEAT_WINDOW_MS) return false;
  lastSaid[politeness] = { message: text, at: now };
  state = { ...state, [politeness]: { message: text, id: nextId++ } };
  listeners.forEach((listener) => listener());
  return true;
}

/** Empties both regions: on a workspace or identity change nothing of the old context is read out. */
export function clearAnnouncements(): void {
  state = { polite: { message: "", id: nextId++ }, assertive: { message: "", id: nextId++ } };
  lastSaid.polite = { message: "", at: -Infinity };
  lastSaid.assertive = { message: "", at: -Infinity };
  listeners.forEach((listener) => listener());
}

export function subscribeAnnouncer(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAnnouncerState(): AnnouncerState {
  return state;
}

const EMPTY: AnnouncerState = { polite: { message: "", id: 0 }, assertive: { message: "", id: 0 } };

/** The server render: both regions empty. */
export function getServerAnnouncerState(): AnnouncerState {
  return EMPTY;
}
