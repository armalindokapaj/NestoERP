import type { Coordinator } from "@/lib/unsaved/coordinator";

/**
 * Browser Back/Forward over unsaved work (AUD-03 §5).
 *
 * `popstate` cannot be cancelled: by the time it fires the URL has already
 * moved. What can be stopped is Next's reaction to it — the router listens on
 * `window` in the bubble phase, so a capture-phase listener registered here
 * runs first and `stopImmediatePropagation()` keeps the router from rendering
 * the other page. The editor never unmounts. The guard then walks the history
 * back to the entry the editor lives on (reconciliation), and asks. On Stay
 * nothing else happens: URL and page are the original ones. On Discard or a
 * committed save the same traversal is replayed once, and this time let
 * through.
 *
 * The distance travelled comes from the Navigation API's entry index, which
 * every engine this app supports exposes (Chromium, Firefox, WebKit). No state
 * is written into history — Next owns `history.state` — and no dummy entries
 * are pushed, so nothing accumulates and nobody is trapped. Where the index is
 * missing the guard stands aside and the native unload prompt is all there is;
 * the handoff documents that limitation.
 */

type NavigationEntryLike = { index: number };
type NavigationLike = {
  currentEntry: NavigationEntryLike | null;
  addEventListener(type: "currententrychange", listener: (event: Event & { navigationType?: string | null }) => void): void;
  removeEventListener(type: "currententrychange", listener: (event: Event & { navigationType?: string | null }) => void): void;
};

function navigationApi(): NavigationLike | null {
  const candidate = (window as unknown as { navigation?: NavigationLike }).navigation;
  return candidate && typeof candidate === "object" && "currentEntry" in candidate ? candidate : null;
}

/** The part of a URL that decides which page renders; a hash-only step leaves the page as it is. */
function pageOf(href: string): string {
  const url = new URL(href);
  return `${url.pathname}${url.search}`;
}

export function historyGuardSupported(): boolean {
  return typeof window !== "undefined" && Boolean(navigationApi()?.currentEntry);
}

export function installHistoryGuard(coordinator: Coordinator): () => void {
  const navigation = navigationApi();
  if (!navigation?.currentEntry) return () => undefined;

  let known = navigation.currentEntry.index;
  let knownPage = pageOf(window.location.href);
  /** The entry the guard is walking back to; its own popstate is swallowed. */
  let restoring: number | null = null;
  /** An approved traversal's destination, which the router may handle. */
  let allowed: number | null = null;

  // Pushes and replaces (links, router.push) move the known entry; traversals
  // are handled in popstate, where the distance is still measurable.
  const onEntryChange = (event: Event & { navigationType?: string | null }) => {
    if (event.navigationType === "traverse") return;
    known = navigation.currentEntry?.index ?? known;
    knownPage = pageOf(window.location.href);
  };

  const onPopState = (event: PopStateEvent) => {
    const index = navigation.currentEntry?.index ?? -1;
    if (restoring !== null) {
      event.stopImmediatePropagation();
      if (index === restoring) restoring = null;
      return;
    }
    const page = pageOf(window.location.href);
    const accept = () => {
      known = index;
      knownPage = page;
    };
    if (allowed !== null && index === allowed) {
      allowed = null;
      accept();
      return;
    }
    const href = window.location.href;
    const guarded = index >= 0 && known >= 0 && index !== known && page !== knownPage && !coordinator.isLeaving() && coordinator.hasBlocking({ kind: "history", href });
    if (!guarded) {
      accept();
      return;
    }

    // Keep the router from rendering the other page, and go back to ours.
    event.stopImmediatePropagation();
    const delta = index - known;
    const origin = known;
    restoring = origin;
    window.history.go(-delta);

    void coordinator.requestDeparture({ kind: "history", href }).then((approval) => {
      if (!approval) return;
      approval.run(() => {
        allowed = origin + delta;
        // The restore may still be in flight; traverse once it has landed.
        const go = () => {
          if (restoring === null) window.history.go(delta);
          else window.setTimeout(go, 16);
        };
        go();
      });
    });
  };

  // A page restored from the back/forward cache starts from where it now is.
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    restoring = null;
    allowed = null;
    known = navigation.currentEntry?.index ?? known;
    knownPage = pageOf(window.location.href);
  };

  navigation.addEventListener("currententrychange", onEntryChange);
  window.addEventListener("popstate", onPopState, { capture: true });
  window.addEventListener("pageshow", onPageShow);
  return () => {
    navigation.removeEventListener("currententrychange", onEntryChange);
    window.removeEventListener("popstate", onPopState, { capture: true });
    window.removeEventListener("pageshow", onPageShow);
  };
}
