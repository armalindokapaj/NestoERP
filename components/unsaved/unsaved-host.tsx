"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { useUnsavedSnapshot } from "@/components/unsaved/use-unsaved";
import { activeRecorder, GUARD_MODULES, routeFamily, type GuardModule } from "@/lib/navigation/telemetry-registry";
import { unsaved, type DepartureIntent, type Freeze, type Prompt, type PromptEditor } from "@/lib/unsaved/coordinator";
import { installHistoryGuard } from "@/lib/unsaved/history-guard";
import { installContextHeader, setTabContext, tabIdentity, tabWorkspace, type TabIdentity, type TabWorkspace } from "@/lib/unsaved/tab-context";
import { restoreTabWorkspace } from "@/lib/workspace/client";
import { cn } from "@/lib/utils/cn";

/**
 * The tab's unsaved-work host (AUD-03 §3-§8).
 *
 * Mounted once in the application shell, above the workspace-keyed page, so it
 * outlives every editor it protects. It renders the one "You have unsaved
 * changes" prompt for whatever departure is pending, owns the single
 * `beforeunload` listener (attached only while something would be lost),
 * installs the Back/Forward guard and the stale-context request header, and
 * holds writes when the tab's context stops being the server's: another tab
 * switched the workspace, the session ended, somebody else signed in.
 */

const GUARD_MODULE_SET = new Set<string>(GUARD_MODULES);
const IDENTITY_CHANNEL = "nesto-identity";

type IdentityMessage = { type: "present" | "signed-out"; user: string; session: string };

/** Tells the browser's other tabs that this session is ending, before it ends (§7). */
export function announceSignOut(): void {
  const identity = tabIdentity();
  if (!identity || typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(IDENTITY_CHANNEL);
  channel.postMessage({ type: "signed-out", ...identity } satisfies IdentityMessage);
  channel.close();
}

/** The session ended under this tab — the bell's poll answered 401 (§7). */
export function handleSessionLost(): void {
  if (unsaved.hasBlocking({ kind: "reload" })) unsaved.freeze({ reason: "session-expired" });
  else window.location.replace("/login?reason=session-expired");
}

/**
 * Checks the server's canonical context before this tab writes again: after a
 * restore from the back/forward cache, on focus where tabs cannot message each
 * other, when a read says the context moved (§5, §7; UW-20). Writes are held
 * until the answer is known.
 */
export async function reconcileTabContext(): Promise<void> {
  const workspace = tabWorkspace();
  const identity = tabIdentity();
  if (!identity) return;
  // No workspace to compare (the platform area): the same person's new
  // sign-in, which is what asked, is all there is to know.
  if (!workspace) {
    unsaved.freeze(null);
    return;
  }
  unsaved.freeze({ reason: "workspace-unknown" });
  let response: Response;
  try {
    response = await fetch("/api/workspace/context", { cache: "no-store", credentials: "same-origin" });
  } catch {
    // Still unknown: keep holding, and try again on the next focus.
    return;
  }
  if (response.status === 401) {
    unsaved.freeze({ reason: "signed-out" });
    return;
  }
  const body = (await response.json().catch(() => null)) as { data?: { workspaceKey?: string; identity?: TabIdentity } } | null;
  const data = body?.data;
  if (!response.ok || !data?.workspaceKey || !data.identity) return;
  if (data.identity.user !== identity.user) {
    unsaved.freeze({ reason: "identity-changed" });
    return;
  }
  if (data.workspaceKey !== workspace.key) {
    unsaved.freeze({ reason: "workspace-changed", from: workspace.name, to: null });
    return;
  }
  unsaved.freeze(null);
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * `workspace` is null outside the application shell — the platform
 * administration area has no workspace, so no request carries one and no
 * workspace notice applies there.
 */
export function UnsavedHost({ identity, workspace }: { identity: TabIdentity; workspace: TabWorkspace | null }) {
  const snapshot = useUnsavedSnapshot();
  const pathname = usePathname();

  // What this tab renders, for the request header and the approvals (§7).
  useIsomorphicLayoutEffect(() => {
    setTabContext({ workspace, identity });
    unsaved.setIdentity(`${identity.user}:${identity.session}`);
  }, [identity.user, identity.session, workspace?.key, workspace?.name, workspace?.scopeType, workspace?.companyId, workspace?.parentGroupId]);

  React.useEffect(() => unsaved.attachHost(), []);

  React.useEffect(() => {
    installContextHeader();
    const uninstallHistory = installHistoryGuard(unsaved);
    unsaved.onEvent((event) => {
      activeRecorder().record({
        kind: "unsaved_guard",
        route: routeFamily(window.location.pathname),
        event: event.event,
        departure: event.departure,
        module: (GUARD_MODULE_SET.has(event.module) ? event.module : "other") as GuardModule,
        durationMs: event.durationMs === undefined ? undefined : Math.min(60_000, Math.max(0, Math.round(event.durationMs))),
      });
    });
    return () => {
      uninstallHistory();
      unsaved.onEvent(null);
    };
  }, []);

  // One native prompt, attached only while something would be lost (§5).
  const blocking = snapshot.blocking > 0;
  React.useEffect(() => {
    if (!blocking) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsaved.takeDownload() || unsaved.isLeaving() || !unsaved.hasBlocking({ kind: "reload" })) return;
      event.preventDefault();
      // Older engines still read returnValue; its text is never shown.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [blocking]);

  // A navigation that happened anyway makes an open prompt's question moot (§4).
  const lastPath = React.useRef(pathname);
  React.useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    unsaved.cancelPending();
  }, [pathname]);

  // Who else is signed in on this browser (§7).
  React.useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      // No messaging between tabs: check the server's context whenever the tab
      // comes back into view with something unsaved.
      const onVisible = () => {
        if (document.visibilityState === "visible" && unsaved.hasBlocking({ kind: "reload" })) void reconcileTabContext();
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => document.removeEventListener("visibilitychange", onVisible);
    }
    const channel = new BroadcastChannel(IDENTITY_CHANNEL);
    channel.onmessage = (event: MessageEvent<IdentityMessage>) => {
      const message = event.data;
      const mine = tabIdentity();
      if (!message || !mine || typeof message.user !== "string") return;
      const holding = unsaved.hasBlocking({ kind: "reload" });
      if (message.user !== mine.user) {
        if (message.type !== "present") return;
        // Somebody else now owns this browser's session. Security first: the
        // draft is not kept for them to see (§7).
        if (holding) unsaved.freeze({ reason: "identity-changed" });
        else {
          document.documentElement.setAttribute("data-nesto-covered", "");
          window.location.reload();
        }
        return;
      }
      if (message.type === "signed-out" && message.session === mine.session) {
        if (holding) unsaved.freeze({ reason: "signed-out" });
        else window.location.reload();
        return;
      }
      if (message.type === "present" && message.session !== mine.session) {
        const freeze = unsaved.frozen;
        // The same person signed in again: the draft may come back, once the
        // page has been authorized again and re-read (§7).
        if (freeze?.reason === "signed-out" || freeze?.reason === "session-expired") void reconcileTabContext();
      }
    };
    channel.postMessage({ type: "present", ...identity } satisfies IdentityMessage);
    return () => channel.close();
  }, [identity]);

  // Nothing of a draft stays visible once its person may no longer be here (§7).
  const masked = snapshot.freeze?.reason === "signed-out" || snapshot.freeze?.reason === "session-expired" || snapshot.freeze?.reason === "identity-changed";
  React.useEffect(() => {
    const root = document.documentElement;
    if (masked) root.setAttribute("data-unsaved-masked", "");
    else root.removeAttribute("data-unsaved-masked");
  }, [masked]);

  return (
    <>
      {snapshot.prompt ? <UnsavedPrompt key={snapshot.prompt.id} prompt={snapshot.prompt} /> : null}
      {snapshot.freeze ? <FreezeNotice freeze={snapshot.freeze} workspace={workspace} /> : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function departureText(t: ReturnType<typeof useTranslations<"unsaved">>, intent: DepartureIntent): string {
  switch (intent.kind) {
    case "navigate":
      return t("departureNavigate");
    case "history":
      return t("departureHistory");
    case "dismiss":
      return t("departureDismiss");
    case "workspace":
      return t("departureWorkspace", { target: intent.target || t("workspaceChangedAnother") });
    case "identity":
      return intent.action === "sign-out" ? t("departureSignOut") : t("departureSwitchUser");
    case "reload":
      return t("departureReload");
  }
}

function editorMessage(t: ReturnType<typeof useTranslations<"unsaved">>, editor: PromptEditor): string {
  const label = editor.label || t("untitled");
  if (editor.unresolved) return t("unresolved", { label });
  if (editor.pendingUploads) return t("uploading", { label });
  if (editor.saveKind === "none") return editor.workflow ? t("workflowOnly", { label, workflow: editor.workflow }) : t("noOrdinarySave", { label });
  return t("oneEditor", { label });
}

function canSave(editor: PromptEditor | undefined): boolean {
  return Boolean(editor) && editor!.saveKind !== "none" && !editor!.unresolved && !editor!.pendingUploads;
}

/**
 * "You have unsaved changes" (§4, §8). An alert dialog: Stay is focused first
 * and is what Escape and the backdrop mean; they close only this warning, never
 * the editor under it. Discard is visually distinct and never the default.
 */
function UnsavedPrompt({ prompt }: { prompt: Prompt }) {
  const t = useTranslations("unsaved");
  const stayRef = React.useRef<HTMLButtonElement>(null);
  // Whatever had focus when the question was asked: a link, a Close button, the editor.
  const origin = React.useRef<HTMLElement | null>(typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null));
  const titleId = React.useId();
  const descriptionId = React.useId();

  const single = prompt.editors.length === 1 ? prompt.editors[0] : null;
  const reviewing = prompt.phase === "review" ? prompt.editors[prompt.reviewIndex] : undefined;
  const current = reviewing ?? single ?? undefined;
  const busy = prompt.phase === "saving" || prompt.phase === "waiting";
  const discardLabel = current?.unresolved || current?.pendingUploads ? t("leaveAnyway") : t("discard");

  let body: React.ReactNode;
  if (prompt.phase === "waiting") {
    const saving = prompt.editors.find((editor) => editor.saving) ?? prompt.editors[0];
    body = (
      <p className="flex items-center gap-2 text-body text-fg-muted">
        <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
        {t("waiting", { label: saving?.label || t("untitled") })}
      </p>
    );
  } else if (reviewing) {
    body = (
      <>
        <p className="text-table font-medium text-fg">{t("reviewStep", { index: prompt.reviewIndex + 1, count: prompt.editors.length, label: reviewing.label || t("untitled") })}</p>
        <p className="text-body text-fg-muted">{editorMessage(t, reviewing)}</p>
      </>
    );
  } else if (single) {
    body = <p className="text-body text-fg-muted">{editorMessage(t, single)}</p>;
  } else {
    body = (
      <>
        <p className="text-body text-fg-muted">{t("someEditors")}</p>
        <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-body text-fg">
          {prompt.editors.map((editor) => (
            <li key={editor.id} className="break-words">
              {editor.label || t("untitled")}
            </li>
          ))}
        </ul>
      </>
    );
  }

  const saveLabel = (editor: PromptEditor | undefined, andContinue: boolean) =>
    editor?.saveKind === "create" ? (andContinue ? t("createAndContinue") : t("create")) : andContinue ? t("saveAndContinue") : t("save");

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (!open && !busy ? unsaved.stay() : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/40" />
        <DialogPrimitive.Content
          role="alertdialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-testid="unsaved-prompt"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            stayRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            // Back to the editor's first problem after a failed save; otherwise
            // back to the control the departure started from (§8).
            event.preventDefault();
            const next = unsaved.takeAfterClose();
            try {
              if (next) next();
              else if (origin.current?.isConnected) origin.current.focus();
            } catch {
              // Focus is a courtesy.
            }
          }}
          onEscapeKeyDown={(event) => {
            if (prompt.phase === "saving") event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (prompt.phase === "saving") event.preventDefault();
          }}
          className="fixed left-1/2 top-1/2 z-[80] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-dialog outline-none"
        >
          <DialogPrimitive.Title id={titleId} className="text-card font-semibold text-fg">
            {t("title")}
          </DialogPrimitive.Title>
          <div id={descriptionId} className="mt-2 space-y-2">
            <p className="text-body text-fg">{departureText(t, prompt.intent)}</p>
            {body}
            {prompt.phase !== "waiting" ? <p className="text-meta text-fg-subtle">{t("discardExplained")}</p> : null}
          </div>
          {prompt.phase === "saving" ? (
            <p role="status" className="mt-4 flex items-center gap-2 text-body text-fg-muted">
              <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              {t("saving")}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button ref={stayRef} size="lg" variant="secondary" onClick={() => unsaved.stay()} disabled={prompt.phase === "saving"} data-testid="unsaved-stay">
              {t("stay")}
            </Button>
            {prompt.phase === "choose" && !single ? (
              <>
                <Button size="lg" variant="danger" onClick={() => unsaved.discardAll()} data-testid="unsaved-discard">
                  {t("discardAll")}
                </Button>
                <Button size="lg" onClick={() => unsaved.review()} data-testid="unsaved-review">
                  {t("review")}
                </Button>
              </>
            ) : null}
            {prompt.phase === "choose" && single ? (
              <>
                <Button size="lg" variant="danger" onClick={() => unsaved.discardAll()} data-testid="unsaved-discard">
                  {discardLabel}
                </Button>
                {canSave(single) ? (
                  <Button size="lg" onClick={() => void unsaved.saveAndContinue()} data-testid="unsaved-save">
                    {saveLabel(single, true)}
                  </Button>
                ) : null}
              </>
            ) : null}
            {prompt.phase === "review" && reviewing ? (
              <>
                <Button size="lg" variant="danger" onClick={() => unsaved.reviewDiscard()} data-testid="unsaved-review-discard">
                  {t("skip")}
                </Button>
                {canSave(reviewing) ? (
                  <Button size="lg" onClick={() => void unsaved.reviewSave()} data-testid="unsaved-review-save">
                    {saveLabel(reviewing, false)}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * The tab's context is no longer the server's (§7). No Stay: the old context
 * is not active any more. Writes are held until the person chooses.
 */
function FreezeNotice({ freeze, workspace }: { freeze: Freeze; workspace: TabWorkspace | null }) {
  const t = useTranslations("unsaved");
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (freeze.reason !== "identity-changed") return;
    // Another person: nothing of this tab's draft is kept for them.
    unsaved.forceLeave();
    document.documentElement.setAttribute("data-nesto-covered", "");
    window.location.reload();
  }, [freeze.reason]);

  const discardAndReload = () => {
    unsaved.forceLeave();
    window.location.reload();
  };

  const returnToReview = async () => {
    setBusy(true);
    setFailed(false);
    const restored = await restoreTabWorkspace();
    setBusy(false);
    if (!restored) {
      setFailed(true);
      return;
    }
    unsaved.freeze(null);
    // Access and versions are read again before anything is saved.
    router.refresh();
  };

  let title: string;
  let description: React.ReactNode;
  let actions: React.ReactNode = null;
  switch (freeze.reason) {
    case "workspace-changed":
      title = t("workspaceChangedTitle");
      description = (
        <>
          <p>{t("workspaceChangedBody", { from: workspace?.name ?? freeze.from, to: freeze.to ?? t("workspaceChangedAnother") })}</p>
          <p className="text-meta text-fg-subtle">{t("workspaceChangedReturnNote")}</p>
          {failed ? <p role="alert" className="text-table text-danger-strong">{t("workspaceChangedFailed")}</p> : null}
        </>
      );
      actions = (
        <>
          <Button size="lg" variant="danger" onClick={discardAndReload} disabled={busy} data-testid="unsaved-context-discard">
            {t("workspaceChangedDiscard")}
          </Button>
          <Button size="lg" onClick={() => void returnToReview()} disabled={busy} data-testid="unsaved-context-return">
            {busy ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : null}
            {t("workspaceChangedReturn", { from: workspace?.name ?? freeze.from })}
          </Button>
        </>
      );
      break;
    case "workspace-unknown":
      title = t("workspaceUnknownTitle");
      description = <p>{t("workspaceUnknownBody")}</p>;
      actions = (
        <Button size="lg" variant="secondary" onClick={() => void reconcileTabContext()} data-testid="unsaved-context-retry">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          {t("workspaceUnknownTitle")}
        </Button>
      );
      break;
    case "signed-out":
    case "session-expired":
      title = t("signedOutTitle");
      description = <p>{t("signedOutBody")}</p>;
      actions = (
        <>
          <Button
            size="lg"
            variant="danger"
            onClick={() => {
              unsaved.forceLeave();
              window.location.assign("/login");
            }}
            data-testid="unsaved-context-signin"
          >
            {t("discardAndSignIn")}
          </Button>
          <Button size="lg" onClick={() => window.open("/login?reason=session-expired", "_blank", "noopener")} data-testid="unsaved-context-newtab">
            {t("signInNewTab")}
          </Button>
        </>
      );
      break;
    case "identity-changed":
      title = t("identityChangedTitle");
      description = <p>{t("identityChangedBody")}</p>;
      break;
  }

  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[85] bg-black/50" />
        <DialogPrimitive.Content
          role="alertdialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-testid="unsaved-context-notice"
          data-reason={freeze.reason}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-[85] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
            "rounded-2xl border border-line bg-surface p-6 shadow-dialog outline-none",
          )}
        >
          <DialogPrimitive.Title id={titleId} className="text-card font-semibold text-fg">
            {title}
          </DialogPrimitive.Title>
          <div id={descriptionId} className="mt-2 space-y-2 text-body text-fg-muted">
            {description}
          </div>
          {actions ? <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">{actions}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
