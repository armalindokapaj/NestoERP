/**
 * The tab's unsaved-work coordinator (AUD-03 §3, §4).
 *
 * Every editor that holds input a person could lose registers here under its
 * own id. There is no single "dirty" boolean: each entry says whether it is
 * dirty, saving, waiting on an upload or holding a save whose outcome nobody
 * knows, and which departures would destroy it. Anything that is about to
 * destroy editors — a link, Back, closing a dialog, a workspace switch, signing
 * out — asks `requestDeparture` first, and goes on only with the one-shot
 * approval it answers.
 *
 * The coordinator keeps no business values. An editor's inputs stay in the
 * editor; the coordinator holds its label, flags, a revision counter and the
 * adapters it was given (save, focus, sync).
 *
 * Pure TypeScript with no DOM or React, so the rules are unit-tested; the
 * prompt that renders a pending decision is `components/unsaved/unsaved-host`.
 */

/** Whether an editor has an ordinary, explicitly authorized save (§3 Capability). */
export type SaveKind = "save" | "create" | "none";

/**
 * What a save answered (§6). Only `committed` is persistence; everything else
 * keeps the draft. `decision` is a business confirmation the editor shows — a
 * duplicate warning, say — that a person, not the coordinator, must answer.
 */
export type SaveOutcome =
  | { kind: "committed"; redirectTo?: string }
  | { kind: "invalid" | "decision" | "conflict" | "refused" | "failed" | "unknown" };

/** What is about to happen to the editors (§4). */
export type DepartureIntent =
  | { kind: "navigate"; href: string }
  | { kind: "history"; href: string }
  | { kind: "dismiss"; scope: string }
  | { kind: "workspace"; target: string }
  | { kind: "identity"; action: "sign-out" | "switch-user" }
  | { kind: "reload" };

export type DepartureKind = DepartureIntent["kind"];

export type EditorRegistration = {
  /** Shown in the prompt; never sent to telemetry. Read when the prompt opens. */
  label: () => string;
  /** The module, for telemetry only. */
  module: string;
  saveKind: SaveKind;
  /** For an editor whose only way forward is a workflow step ("Send", "Submit"). */
  workflow?: string;
  /** The dialogs this editor sits in, outermost first: closing one of them destroys it. */
  scopes: readonly string[];
  /** Mounted in the shell rather than the page, so a route change does not destroy it. */
  persistsAcrossRoutes?: boolean;
  save?: () => Promise<SaveOutcome>;
  focus?: () => void;
  /** Recompute dirtiness from the editor itself, before a decision is made. */
  sync?: () => void;
};

export type EditorState = {
  dirty: boolean;
  saving: boolean;
  pendingUploads: boolean;
  /** A save was sent and its outcome is unknown (§4, §6). */
  unresolved: boolean;
};

export const CLEAN: EditorState = { dirty: false, saving: false, pendingUploads: false, unresolved: false };

type Entry = {
  id: string;
  token: number;
  registration: EditorRegistration;
  state: EditorState;
  revision: number;
};

export type PromptEditor = {
  id: string;
  label: string;
  saveKind: SaveKind;
  workflow?: string;
  saving: boolean;
  unresolved: boolean;
  pendingUploads: boolean;
};

export type PromptPhase = "choose" | "saving" | "waiting" | "review";

export type Prompt = {
  id: number;
  intent: DepartureIntent;
  editors: PromptEditor[];
  phase: PromptPhase;
  /** In review: which editor is being decided. */
  reviewIndex: number;
};

/** Why writes are held (§7): the tab's context is no longer the server's. */
export type Freeze =
  | { reason: "workspace-changed"; from: string; to: string | null }
  | { reason: "workspace-unknown" }
  | { reason: "signed-out" }
  | { reason: "session-expired" }
  | { reason: "identity-changed" };

export type Snapshot = {
  prompt: Prompt | null;
  /** How many editors hold anything a departure would lose. */
  blocking: number;
  freeze: Freeze | null;
};

export type GuardEvent = {
  event: "prompt" | "stay" | "discard" | "save" | "save_failed" | "continued" | "duplicate_request" | "duplicate_continuation" | "stale_approval" | "guard_error";
  departure: DepartureKind;
  module: string;
  durationMs?: number;
};

/**
 * A one-shot permission to destroy the editors a departure was approved for
 * (§4). It runs its continuation once, and only while those editors are
 * unchanged and the identity is the one it was given in. There is no public
 * "confirmed" flag: an approval is the only way past the guard.
 */
export class Approval {
  #done = false;

  constructor(
    private readonly coordinator: Coordinator,
    readonly intent: DepartureIntent,
    readonly revisions: ReadonlyMap<string, number>,
    readonly identity: string,
  ) {}

  get active(): boolean {
    return !this.#done && this.coordinator.stillApproved(this);
  }

  /** Runs `continuation` once. Answers false — and runs nothing — when used, released or stale. */
  run(continuation: () => void): boolean {
    if (this.#done) {
      this.coordinator.emit({ event: "duplicate_continuation", departure: this.intent.kind, module: "shell" });
      return false;
    }
    this.#done = true;
    if (!this.coordinator.stillApproved(this)) {
      this.coordinator.emit({ event: "stale_approval", departure: this.intent.kind, module: "shell" });
      return false;
    }
    // A dismissal closes a dialog or an inline editor and the page stays: the
    // guards must go on protecting every other editor on it at once. Only a
    // departure that carries the page away holds them aside while it happens.
    if (this.intent.kind !== "dismiss") this.coordinator.beginLeaving(this);
    continuation();
    return true;
  }

  /** The departure failed or was abandoned: the guards protect these editors again. */
  release(): void {
    this.#done = true;
    this.coordinator.endLeaving(this);
  }
}

type Pending = {
  prompt: Prompt;
  resolve: (approval: Approval | null) => void;
  startedAt: number;
  /** Editors approved for discard during a review, at the revision they were approved. */
  discarded: Map<string, number>;
};

/** How long a used approval lets its editors go without a native prompt while the page leaves. */
export const LEAVING_WINDOW_MS = 15_000;
/** How long a started download may take to reach the browser before its request counts as leaving. */
export const DOWNLOAD_WINDOW_MS = 3_000;

function isBlocking(state: EditorState): boolean {
  return state.dirty || state.saving || state.pendingUploads || state.unresolved;
}

function affects(entry: Entry, intent: DepartureIntent): boolean {
  switch (intent.kind) {
    case "dismiss":
      return entry.registration.scopes.includes(intent.scope);
    case "navigate":
    case "history":
      return !entry.registration.persistsAcrossRoutes;
    default:
      return true;
  }
}

export class Coordinator {
  #entries = new Map<string, Entry>();
  #tokens = 0;
  #prompts = 0;
  #pending: Pending | null = null;
  #leaving: { approval: Approval; until: number } | null = null;
  #forcedUntil = 0;
  #freeze: Freeze | null = null;
  #identity = "";
  #listeners = new Set<() => void>();
  #snapshot: Snapshot = { prompt: null, blocking: 0, freeze: null };
  #onEvent: ((event: GuardEvent) => void) | null = null;
  #afterClose: (() => void) | null = null;
  #hosts = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /* ---------------------------------------------------------------- store */

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.#snapshot;

  #notify(): void {
    const blocking = [...this.#entries.values()].filter((entry) => isBlocking(entry.state)).length;
    const prompt = this.#pending?.prompt ?? null;
    const previous = this.#snapshot;
    if (previous.prompt === prompt && previous.blocking === blocking && previous.freeze === this.#freeze) return;
    this.#snapshot = { prompt, blocking, freeze: this.#freeze };
    for (const listener of [...this.#listeners]) listener();
  }

  onEvent(handler: ((event: GuardEvent) => void) | null): void {
    this.#onEvent = handler;
  }

  emit(event: GuardEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // Telemetry never gets in the way of a decision.
    }
  }

  /* ----------------------------------------------------------------- host */

  /**
   * The prompt's renderer. A page outside the application shell has none; its
   * departures fall back to the browser's own confirmation rather than wait
   * for a prompt nobody draws.
   */
  attachHost(): () => void {
    this.#hosts += 1;
    return () => {
      this.#hosts -= 1;
    };
  }

  /* ------------------------------------------------------------- identity */

  /** The signed-in identity generation this tab renders; approvals are bound to it. */
  setIdentity(identity: string): void {
    this.#identity = identity;
  }

  get identity(): string {
    return this.#identity;
  }

  /* ------------------------------------------------------------- registry */

  /**
   * Registers (or re-registers) an editor. Answers the token that its
   * unregistration must present: an unmount that belongs to an earlier mount —
   * React Strict Mode runs effects twice — cannot remove the current one (§3).
   */
  register(id: string, registration: EditorRegistration, state: EditorState = CLEAN): number {
    const token = ++this.#tokens;
    const previous = this.#entries.get(id);
    this.#entries.set(id, { id, token, registration, state: { ...state }, revision: previous?.revision ?? 0 });
    this.#notify();
    return token;
  }

  unregister(id: string, token: number): void {
    const entry = this.#entries.get(id);
    if (!entry || entry.token !== token) return;
    this.#entries.delete(id);
    // An editor that left while a prompt was about it is no longer in question.
    if (this.#pending) this.#reassess();
    this.#notify();
  }

  update(id: string, patch: Partial<EditorState>): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    const next = { ...entry.state, ...patch };
    if (next.dirty === entry.state.dirty && next.saving === entry.state.saving && next.pendingUploads === entry.state.pendingUploads && next.unresolved === entry.state.unresolved) return;
    const wasSaving = entry.state.saving;
    entry.state = next;
    // New input invalidates an approval given for the old revision (§4).
    if (patch.dirty !== undefined) entry.revision += 1;
    if (this.#pending && wasSaving && !next.saving) this.#reassess();
    this.#notify();
  }

  /** A change inside an editor that did not flip any flag: it still invalidates approvals. */
  touch(id: string): void {
    const entry = this.#entries.get(id);
    if (entry) entry.revision += 1;
  }

  state(id: string): EditorState | null {
    return this.#entries.get(id)?.state ?? null;
  }

  registered(): number {
    return this.#entries.size;
  }

  /** The editors a departure would destroy and that hold something to lose. */
  affected(intent: DepartureIntent): Entry[] {
    for (const entry of this.#entries.values()) {
      if (!affects(entry, intent)) continue;
      try {
        entry.registration.sync?.();
      } catch {
        this.emit({ event: "guard_error", departure: intent.kind, module: entry.registration.module });
      }
    }
    return [...this.#entries.values()].filter((entry) => affects(entry, intent) && isBlocking(entry.state));
  }

  hasBlocking(intent: DepartureIntent): boolean {
    return this.affected(intent).length > 0;
  }

  /* ---------------------------------------------------------------- freeze */

  freeze(freeze: Freeze | null): void {
    this.#freeze = freeze;
    if (freeze && this.#pending) this.#settle(null);
    this.#notify();
  }

  get frozen(): Freeze | null {
    return this.#freeze;
  }

  /* ------------------------------------------------------------- departure */

  /**
   * Asks whether the editors `intent` would destroy may go. Answers at once
   * with an approval when nothing would be lost. Otherwise the prompt opens and
   * the answer waits for the person. While one prompt is open, another request
   * is refused rather than queued or allowed to replace the first one's
   * destination (§4).
   */
  requestDeparture(intent: DepartureIntent, options: { prior?: Approval | null } = {}): Promise<Approval | null> {
    if (this.#pending) {
      this.emit({ event: "duplicate_request", departure: intent.kind, module: "shell" });
      return Promise.resolve(null);
    }
    // One question for one action (NAV-05): editors a step earlier in the same
    // flow already approved, unchanged since, are not asked about again.
    const prior = options.prior && options.prior.identity === this.#identity ? options.prior : null;
    const all = this.affected(intent);
    const affected = all.filter((entry) => prior?.revisions.get(entry.id) !== entry.revision);
    if (affected.length === 0) {
      return Promise.resolve(new Approval(this, intent, new Map(all.map((entry) => [entry.id, entry.revision])), this.#identity));
    }
    if (this.#hosts === 0) {
      const discard = typeof window !== "undefined" && typeof window.confirm === "function" && window.confirm("You have unsaved changes. Discard them and continue?");
      this.emit({ event: discard ? "discard" : "stay", departure: intent.kind, module: affected[0]!.registration.module });
      return Promise.resolve(discard ? new Approval(this, intent, new Map(all.map((entry) => [entry.id, entry.revision])), this.#identity) : null);
    }

    return new Promise((resolve) => {
      this.#pending = {
        prompt: {
          id: ++this.#prompts,
          intent,
          editors: affected.map(toPromptEditor),
          phase: affected.some((entry) => entry.state.saving) ? "waiting" : "choose",
          reviewIndex: 0,
        },
        resolve,
        startedAt: this.now(),
        discarded: new Map(),
      };
      for (const entry of affected) this.emit({ event: "prompt", departure: intent.kind, module: entry.registration.module });
      this.#notify();
    });
  }

  /** Stay: nothing leaves, nothing is sent (§4). Escape and the backdrop mean this too. */
  stay(): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#emitFor(pending, "stay");
    this.#settle(null);
  }

  /** Cancels an open prompt because its context went away (§4): a navigation elsewhere, a freeze. */
  cancelPending(): void {
    if (this.#pending) this.#settle(null);
  }

  /** Discard every affected editor's changes: approves the departure at their current revisions. */
  discardAll(): void {
    const pending = this.#pending;
    if (!pending || pending.prompt.phase === "saving") return;
    this.#emitFor(pending, "discard");
    const affected = this.affected(pending.prompt.intent);
    this.#approve(pending, new Map(affected.map((entry) => [entry.id, entry.revision])));
  }

  /**
   * Save and continue for one editor (§4): the editor's own save, with its own
   * validation, authorization and duplicate checks. Only a committed save lets
   * the departure go on; anything else cancels it and leaves the editor to show
   * why.
   */
  async saveAndContinue(): Promise<void> {
    const pending = this.#pending;
    if (!pending || pending.prompt.phase !== "choose") return;
    const target = pending.prompt.editors.length === 1 ? pending.prompt.editors[0] : null;
    if (!target) return;
    await this.#saveOne(pending, target.id, () => this.#reassess());
  }

  /** Several editors: decide them one by one (§4). */
  review(): void {
    const pending = this.#pending;
    if (!pending || pending.prompt.phase !== "choose" || pending.prompt.editors.length < 2) return;
    this.#setPrompt(pending, { phase: "review", reviewIndex: 0 });
  }

  async reviewSave(): Promise<void> {
    const pending = this.#pending;
    if (!pending || pending.prompt.phase !== "review") return;
    const target = pending.prompt.editors[pending.prompt.reviewIndex];
    if (!target) return;
    await this.#saveOne(pending, target.id, () => this.#nextReview(pending));
  }

  reviewDiscard(): void {
    const pending = this.#pending;
    if (!pending || pending.prompt.phase !== "review") return;
    const target = pending.prompt.editors[pending.prompt.reviewIndex];
    if (!target) return;
    const entry = this.#entries.get(target.id);
    if (entry) {
      pending.discarded.set(entry.id, entry.revision);
      this.emit({ event: "discard", departure: pending.prompt.intent.kind, module: entry.registration.module });
    }
    this.#nextReview(pending);
  }

  async #saveOne(pending: Pending, id: string, onCommitted: () => void): Promise<void> {
    const entry = this.#entries.get(id);
    if (!entry?.registration.save || entry.registration.saveKind === "none" || entry.state.unresolved || this.#freeze) return;
    const promptId = pending.prompt.id;
    this.#setPrompt(pending, { phase: "saving" });
    const startedAt = this.now();
    let outcome: SaveOutcome;
    try {
      outcome = await entry.registration.save();
    } catch {
      outcome = { kind: "unknown" };
    }
    // The prompt was closed meanwhile (the editor left, the context changed).
    if (this.#pending !== pending || pending.prompt.id !== promptId) return;
    const moduleKey = entry.registration.module;
    if (outcome.kind === "committed") {
      this.emit({ event: "save", departure: pending.prompt.intent.kind, module: moduleKey, durationMs: this.now() - startedAt });
      this.#setPrompt(pending, { phase: pending.prompt.editors.length > 1 ? "review" : "choose" });
      onCommitted();
      return;
    }
    this.emit({ event: "save_failed", departure: pending.prompt.intent.kind, module: moduleKey, durationMs: this.now() - startedAt });
    // Invalid, refused, a conflict or an unknown outcome: the departure is
    // cancelled and the editor shows what happened (§4, §6). Focus goes to
    // the editor — its first invalid field — once the prompt has closed.
    this.#afterClose = () => entry.registration.focus?.();
    this.#settle(null);
  }

  /** What should take focus when the prompt closes, instead of the control that opened it. */
  takeAfterClose(): (() => void) | null {
    const next = this.#afterClose;
    this.#afterClose = null;
    return next;
  }

  #nextReview(pending: Pending): void {
    const next = pending.prompt.reviewIndex + 1;
    if (next < pending.prompt.editors.length) {
      this.#setPrompt(pending, { phase: "review", reviewIndex: next });
      return;
    }
    this.#reassess();
  }

  /**
   * Looks again at what the pending departure would destroy: after a save,
   * after an editor stopped saving or left. Goes on when nothing blocking
   * remains beyond what was explicitly discarded; otherwise asks again about
   * what is left (§4: "Recheck all affected editors before departure").
   */
  #reassess(): void {
    const pending = this.#pending;
    if (!pending) return;
    if (pending.prompt.phase === "saving") return;
    const affected = this.affected(pending.prompt.intent);
    const remaining = affected.filter((entry) => pending.discarded.get(entry.id) !== entry.revision);
    if (remaining.length === 0) {
      this.#approve(pending, new Map(affected.map((entry) => [entry.id, entry.revision])));
      return;
    }
    if (remaining.some((entry) => entry.state.saving)) {
      this.#setPrompt(pending, { phase: "waiting", editors: remaining.map(toPromptEditor), reviewIndex: 0 });
      return;
    }
    if (pending.prompt.phase === "review" && pending.prompt.reviewIndex < pending.prompt.editors.length - 1) return;
    this.#setPrompt(pending, { phase: "choose", editors: remaining.map(toPromptEditor), reviewIndex: 0 });
  }

  #approve(pending: Pending, revisions: Map<string, number>): void {
    const approval = new Approval(this, pending.prompt.intent, revisions, this.#identity);
    this.emit({ event: "continued", departure: pending.prompt.intent.kind, module: "shell", durationMs: this.now() - pending.startedAt });
    this.#settle(approval);
  }

  #settle(approval: Approval | null): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    this.#notify();
    pending.resolve(approval);
  }

  #setPrompt(pending: Pending, patch: Partial<Prompt>): void {
    pending.prompt = { ...pending.prompt, ...patch };
    this.#notify();
  }

  #emitFor(pending: Pending, event: GuardEvent["event"]): void {
    for (const editor of pending.prompt.editors) {
      const moduleKey = this.#entries.get(editor.id)?.registration.module ?? "unknown";
      this.emit({ event, departure: pending.prompt.intent.kind, module: moduleKey, durationMs: this.now() - pending.startedAt });
    }
  }

  /* -------------------------------------------------------------- approvals */

  /**
   * An approval holds while the identity is unchanged and every editor its
   * departure would destroy is either clean or still at the revision it was
   * approved at. A new edit, or a newly dirty editor, voids it (§4).
   */
  stillApproved(approval: Approval): boolean {
    if (approval.identity !== this.#identity) return false;
    for (const entry of this.affected(approval.intent)) {
      if (approval.revisions.get(entry.id) !== entry.revision) return false;
    }
    return true;
  }

  beginLeaving(approval: Approval): void {
    this.#leaving = { approval, until: this.now() + LEAVING_WINDOW_MS };
  }

  endLeaving(approval: Approval): void {
    if (this.#leaving?.approval === approval) this.#leaving = null;
  }

  /** Clears every outstanding approval: a page restored from history must not replay one (§5). */
  forgetApprovals(): void {
    this.#leaving = null;
    this.#forcedUntil = 0;
    this.#downloadUntil = 0;
  }

  #downloadUntil = 0;

  /**
   * A forced-attachment download is starting in this document. The browser
   * asks `beforeunload` before it knows the response will not replace the
   * page, so the native prompt stands aside for this one request — the page
   * and its editors stay (§8).
   */
  expectDownload(): void {
    this.#downloadUntil = this.now() + DOWNLOAD_WINDOW_MS;
  }

  /** Read once by the unload handler: only the download's own request is let through. */
  takeDownload(): boolean {
    if (this.now() >= this.#downloadUntil) return false;
    this.#downloadUntil = 0;
    return true;
  }

  /**
   * The page is being discarded on purpose, by a decision already made
   * elsewhere — "Discard and switch", or another person signing in, where
   * security outranks recovery (§7). No prompt stands in the way of it.
   */
  forceLeave(): void {
    this.#forcedUntil = this.now() + LEAVING_WINDOW_MS;
  }

  /**
   * True while an approved departure is carrying the page away — the native
   * unload prompt and the history guard stand aside for it, once.
   */
  isLeaving(): boolean {
    if (this.now() < this.#forcedUntil) return true;
    const leaving = this.#leaving;
    if (!leaving) return false;
    if (this.now() > leaving.until || !this.stillApproved(leaving.approval)) {
      this.#leaving = null;
      return false;
    }
    return true;
  }

  /** Test support: forget everything. */
  reset(): void {
    this.#entries.clear();
    this.#pending = null;
    this.#leaving = null;
    this.#forcedUntil = 0;
    this.#freeze = null;
    this.#snapshot = { prompt: null, blocking: 0, freeze: null };
  }
}

function toPromptEditor(entry: Entry): PromptEditor {
  let label: string;
  try {
    label = entry.registration.label();
  } catch {
    label = "";
  }
  return {
    id: entry.id,
    label,
    saveKind: entry.registration.saveKind,
    workflow: entry.registration.workflow,
    saving: entry.state.saving,
    unresolved: entry.state.unresolved,
    pendingUploads: entry.state.pendingUploads,
  };
}

/** The tab's coordinator. Tab-local by construction: a module instance per document. */
export const unsaved = new Coordinator();
