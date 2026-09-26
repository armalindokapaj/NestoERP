"use client";

import * as React from "react";

import {
  CLEAN,
  unsaved,
  type EditorState,
  type SaveKind,
  type SaveOutcome,
  type Snapshot,
} from "@/lib/unsaved/coordinator";
import { diffNames, isIgnoredName, readField, readForm, sameValues, type FormBaseline } from "@/lib/unsaved/form-snapshot";

/**
 * The editor side of the unsaved-work contract (AUD-03 §3).
 *
 * `useUnsavedEditor` registers one editor with the tab's coordinator under a
 * stable id and hands back setters for its flags. `useFormDirty` derives a
 * native form's dirtiness from what it would submit. `UnsavedScope` tells the
 * editors inside a dialog that closing that dialog destroys them.
 */

const ScopeContext = React.createContext<readonly string[]>([]);

/** Marks everything inside as belonging to a dialog or drawer that can be closed (§5). */
export function UnsavedScope({ id, children }: { id: string; children: React.ReactNode }) {
  const parent = React.useContext(ScopeContext);
  const scopes = React.useMemo(() => [...parent, id], [parent, id]);
  return React.createElement(ScopeContext.Provider, { value: scopes }, children);
}

export function useUnsavedScopes(): readonly string[] {
  return React.useContext(ScopeContext);
}

export type UnsavedEditorOptions = {
  /** The label the prompt names; read when the prompt opens. Defaults to the page heading. */
  label?: string | (() => string);
  /** For telemetry: a module key, never a record's name. The route's first segment when absent. */
  module?: string;
  /** Whether an ordinary, authorized Save/Create exists (§3). Not inferred from a submit button. */
  saveKind: SaveKind;
  /** For an editor that only a workflow step finishes ("Send"). */
  workflow?: string;
  /** Mounted in the shell, so a route change leaves it in place. */
  persistsAcrossRoutes?: boolean;
  save?: () => Promise<SaveOutcome>;
  focus?: () => void;
  sync?: () => void;
};

export type UnsavedEditor = {
  id: string;
  dirty: boolean;
  saving: boolean;
  unresolved: boolean;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  setPendingUploads: (pending: boolean) => void;
  setUnresolved: (unresolved: boolean) => void;
  /** A change that did not flip dirtiness still voids an approval given before it. */
  touch: () => void;
  /** Asks before destroying this editor in place (Cancel, a reset); runs `discard` on approval. */
  requestDismiss: (discard: () => void) => Promise<boolean>;
};

/** The module a route belongs to, from its first segment, for telemetry only. */
function routeModule(): string {
  if (typeof window === "undefined") return "other";
  return (window.location.pathname.split("/")[1] ?? "other").replace(/-/g, "_") || "other";
}

function pageHeading(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector("#nesto-main h1")?.textContent?.trim() ?? "";
}

export function useUnsavedEditor(options: UnsavedEditorOptions): UnsavedEditor {
  const id = React.useId();
  const scopes = useUnsavedScopes();
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const stateRef = React.useRef<EditorState>({ ...CLEAN });
  const [state, setState] = React.useState<EditorState>(CLEAN);

  const scopeKey = scopes.join("/");
  React.useEffect(() => {
    const token = unsaved.register(
      id,
      {
        label: () => {
          const label = optionsRef.current.label;
          return (typeof label === "function" ? label() : label) || pageHeading();
        },
        module: optionsRef.current.module ?? routeModule(),
        saveKind: optionsRef.current.saveKind,
        workflow: optionsRef.current.workflow,
        // Every editor is also its own scope, for an in-place dismissal of it alone.
        scopes: [...(scopeKey ? scopeKey.split("/") : []), `editor:${id}`],
        persistsAcrossRoutes: optionsRef.current.persistsAcrossRoutes,
        save: () => (optionsRef.current.save ? optionsRef.current.save() : Promise.resolve({ kind: "unknown" } as SaveOutcome)),
        focus: () => optionsRef.current.focus?.(),
        sync: () => optionsRef.current.sync?.(),
      },
      stateRef.current,
    );
    return () => unsaved.unregister(id, token);
    // saveKind and workflow are part of the registration: a change re-registers.
  }, [id, scopeKey, options.saveKind, options.workflow, options.persistsAcrossRoutes, options.module]);

  const patch = React.useCallback(
    (next: Partial<EditorState>) => {
      const merged = { ...stateRef.current, ...next };
      stateRef.current = merged;
      // The coordinator hears at once — a click that follows a keystroke must
      // see it — and the editor re-renders for its indicator.
      unsaved.update(id, next);
      setState((previous) =>
        previous.dirty === merged.dirty && previous.saving === merged.saving && previous.pendingUploads === merged.pendingUploads && previous.unresolved === merged.unresolved ? previous : merged,
      );
    },
    [id],
  );

  const requestDismiss = React.useCallback(
    async (discard: () => void) => {
      if (!stateRef.current.dirty && !stateRef.current.saving && !stateRef.current.pendingUploads && !stateRef.current.unresolved) {
        discard();
        return true;
      }
      const approval = await unsaved.requestDeparture({ kind: "dismiss", scope: `editor:${id}` });
      if (!approval) return false;
      return approval.run(discard);
    },
    [id],
  );

  const setters = React.useMemo(
    () => ({
      setDirty: (dirty: boolean) => patch({ dirty }),
      setSaving: (saving: boolean) => patch({ saving }),
      setPendingUploads: (pendingUploads: boolean) => patch({ pendingUploads }),
      setUnresolved: (unresolved: boolean) => patch({ unresolved }),
      touch: () => unsaved.touch(id),
    }),
    [id, patch],
  );

  return React.useMemo(
    () => ({ id, dirty: state.dirty, saving: state.saving, unresolved: state.unresolved, ...setters, requestDismiss }),
    [id, state.dirty, state.saving, state.unresolved, setters, requestDismiss],
  );
}

/** A trusted gesture this recently makes a programmatic field change the person's own (rule 5). */
const GESTURE_WINDOW_MS = 1500;
let lastGestureAt = -Infinity;
if (typeof window !== "undefined") {
  const mark = (event: Event) => {
    if (event.isTrusted) lastGestureAt = performance.now();
  };
  for (const type of ["pointerdown", "keydown", "paste", "drop", "touchstart"]) {
    window.addEventListener(type, mark, { capture: true, passive: true });
  }
}

/**
 * A gesture made after `since` (the baseline) and within the window. The
 * click that saved — or that opened the page — happened before the baseline
 * it produced, so a refresh arriving just after it is not the person's edit.
 */
function recentGesture(since: number): boolean {
  return lastGestureAt > since && performance.now() - lastGestureAt < GESTURE_WINDOW_MS;
}

export type FormDirty = {
  /** A full comparison now — before a decision, or after a change nothing announced. */
  sync: () => void;
  /**
   * The form's current values — or `sent`, the snapshot a committed save
   * carried — become the baseline: only after a committed save (rule 7).
   */
  rebaseline: (sent?: FormBaseline) => void;
};

/**
 * Tracks a native form's dirtiness against a semantic baseline (§3 rules 1-6).
 *
 * The baseline is what the form would submit once it has loaded. Until the
 * person first interacts, changes are loading — defaults, hydration, a custom
 * control filling its hidden input — and move the baseline instead. After
 * that, a change counts when it follows a trusted gesture (typing, a click in a
 * popover that writes a hidden input); one that arrives on its own is a
 * background refresh, which may move the baseline of a field the person has
 * not touched but never overwrites one they have.
 */
export function useFormDirty(
  formRef: React.RefObject<HTMLFormElement | null>,
  editor: Pick<UnsavedEditor, "setDirty" | "touch">,
  options: {
    ignore?: readonly string[];
    paused?: boolean;
    /** Saved values for fields the form opens with unsaved values in: they start dirty. */
    baseline?: Record<string, string>;
  } = {},
): FormDirty {
  const baseline = React.useRef<FormBaseline>(new Map());
  const changed = React.useRef<Set<string>>(new Set());
  const interacted = React.useRef(false);
  /** When the current baseline was taken: gestures before it made it. */
  const baselineAt = React.useRef(0);
  const ignore = React.useMemo(() => new Set(options.ignore ?? []), [options.ignore]);
  const paused = React.useRef(Boolean(options.paused));
  paused.current = Boolean(options.paused);
  const editorRef = React.useRef(editor);
  editorRef.current = editor;
  const initialBaseline = React.useRef(options.baseline);

  const publish = React.useCallback(() => {
    editorRef.current.setDirty(changed.current.size > 0);
  }, []);

  const sync = React.useCallback(() => {
    const form = formRef.current;
    if (!form || paused.current) return;
    const current = readForm(form, ignore);
    if (!interacted.current) {
      baseline.current = current;
      changed.current = new Set();
    } else {
      changed.current = diffNames(baseline.current, current);
    }
    publish();
  }, [formRef, ignore, publish]);

  const rebaseline = React.useCallback((sent?: FormBaseline) => {
    const form = formRef.current;
    if (!form) return;
    baseline.current = sent ?? readForm(form, ignore);
    baselineAt.current = performance.now();
    changed.current = new Set();
    interacted.current = false;
    editorRef.current.touch();
    publish();
  }, [formRef, ignore, publish]);

  React.useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    baseline.current = readForm(form, ignore);
    baselineAt.current = performance.now();
    changed.current = new Set();
    interacted.current = false;
    const saved = initialBaseline.current;
    if (saved) {
      // Opened on values that are not saved: compared with the saved ones.
      for (const [name, value] of Object.entries(saved)) baseline.current.set(name, [`s:${value}`]);
      changed.current = diffNames(baseline.current, readForm(form, ignore));
      interacted.current = changed.current.size > 0;
      publish();
    }

    const markInteraction = (event: Event) => {
      if (event.isTrusted) interacted.current = true;
    };

    /** One field, compared with its baseline; `user` says the person made the change. */
    const checkField = (name: string, user: boolean) => {
      if (paused.current || isIgnoredName(name, ignore)) return;
      const values = readField(form, name);
      if (!interacted.current && !user) {
        baseline.current.set(name, values);
        return;
      }
      if (user) interacted.current = true;
      const differs = !sameValues(baseline.current.get(name), values);
      if (!user && !changed.current.has(name)) {
        // A change the person did not make, to a field they have not touched:
        // the server's newer value, not an edit.
        baseline.current.set(name, values);
        return;
      }
      const was = changed.current.has(name);
      if (differs) changed.current.add(name);
      else changed.current.delete(name);
      editorRef.current.touch();
      if (was !== differs) publish();
    };

    const onInput = (event: Event) => {
      const target = event.target as Element | null;
      const name = target && "name" in target ? String((target as HTMLInputElement).name) : "";
      if (!name || target?.closest("[data-unsaved-ignore]")) return;
      checkField(name, event.isTrusted || recentGesture(baselineAt.current));
    };

    // Rows added or removed, hidden inputs a custom control writes, fields
    // enabled or disabled: nothing announces these, so they are observed.
    let structural = false;
    let scheduled = false;
    const touchedNames = new Set<string>();
    const flush = () => {
      scheduled = false;
      if (paused.current) return;
      const user = recentGesture(baselineAt.current);
      if (structural) {
        structural = false;
        touchedNames.clear();
        const current = readForm(form, ignore);
        if (!interacted.current && !user) {
          baseline.current = current;
          return;
        }
        if (user) interacted.current = true;
        const next = diffNames(baseline.current, current);
        if (!user) {
          // Fields that changed on their own and were not already edited follow the server.
          for (const name of next) {
            if (!changed.current.has(name)) {
              baseline.current.set(name, current.get(name) ?? []);
              next.delete(name);
            }
          }
        }
        changed.current = next;
        editorRef.current.touch();
        publish();
        return;
      }
      for (const name of touchedNames) checkField(name, user);
      touchedNames.clear();
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          const nodes = [...record.addedNodes, ...record.removedNodes];
          if (nodes.some((node) => node instanceof Element && (node.matches("input,select,textarea") || node.querySelector("input,select,textarea")))) structural = true;
        } else if (record.target instanceof Element) {
          const name = (record.target as HTMLInputElement).name;
          if (name) touchedNames.add(name);
          else if (record.attributeName === "disabled") structural = true;
        }
      }
      if (structural || touchedNames.size) schedule();
    });
    observer.observe(form, { subtree: true, childList: true, attributes: true, attributeFilter: ["value", "disabled", "name", "checked"] });

    form.addEventListener("input", onInput, true);
    form.addEventListener("change", onInput, true);
    form.addEventListener("pointerdown", markInteraction, true);
    form.addEventListener("keydown", markInteraction, true);
    return () => {
      observer.disconnect();
      form.removeEventListener("input", onInput, true);
      form.removeEventListener("change", onInput, true);
      form.removeEventListener("pointerdown", markInteraction, true);
      form.removeEventListener("keydown", markInteraction, true);
    };
  }, [formRef, ignore, publish]);

  return React.useMemo(() => ({ sync, rebaseline }), [sync, rebaseline]);
}

/** The coordinator's snapshot, for the host and for editors that show the freeze. */
export function useUnsavedSnapshot(): Snapshot {
  return React.useSyncExternalStore(unsaved.subscribe, unsaved.getSnapshot, unsaved.getSnapshot);
}

/** True while writes are held because the tab's context is no longer the server's (§7). */
export function useUnsavedFrozen(): boolean {
  return useUnsavedSnapshot().freeze !== null;
}
