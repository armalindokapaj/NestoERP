import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { belowQuery, BREAKPOINTS, mediaQueryStore, resetMediaQueryStores, TOUCH_QUERY, useIsBelow, useMediaQuery } from "@/components/ui/use-breakpoint";

/**
 * The one breakpoint hook (AUD-04 §3, §8; SP-15, MW-16): the server and the
 * hydrating render agree on "not known yet", the queries match the design
 * system's Tailwind variants, and one store per query is shared.
 */

type Listener = () => void;

function fakeMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const list = {
    matches: initial,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  } as unknown as MediaQueryList & { matches: boolean };
  return {
    list,
    listeners,
    set(value: boolean) {
      (list as { matches: boolean }).matches = value;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => resetMediaQueryStores());

describe("breakpoint queries", () => {
  it("mirror Tailwind's max-<bp> variants and the touch: variant", () => {
    expect(BREAKPOINTS).toMatchObject({ sm: 640, md: 768, lg: 1024 });
    expect(belowQuery("md")).toBe("(max-width: 767.98px)");
    expect(belowQuery("lg")).toBe("(max-width: 1023.98px)");
    expect(TOUCH_QUERY).toBe("(max-width: 1023.98px), (pointer: coarse)");
  });
});

describe("mediaQueryStore", () => {
  it("reads the current match and notifies subscribers on change", () => {
    const media = fakeMedia(false);
    let asked = 0;
    const store = mediaQueryStore("(max-width: 767.98px)", () => {
      asked += 1;
      return media.list;
    });
    expect(store.getSnapshot()).toBe(false);

    let notified = 0;
    const unsubscribe = store.subscribe(() => (notified += 1));
    media.set(true);
    expect(notified).toBe(1);
    expect(store.getSnapshot()).toBe(true);

    unsubscribe();
    media.set(false);
    expect(notified).toBe(1);
    expect(media.listeners.size).toBe(0);
    // One MediaQueryList for the query, however often it is read.
    expect(asked).toBe(1);
  });

  it("is shared by every caller asking the same question", () => {
    const media = fakeMedia(true);
    const first = mediaQueryStore("(pointer: coarse)", () => media.list);
    const second = mediaQueryStore("(pointer: coarse)", () => fakeMedia(false).list);
    expect(second).toBe(first);
    expect(second.getSnapshot()).toBe(true);
  });
});

describe("useMediaQuery on the server", () => {
  it("renders undefined, not a guessed device type, so hydration cannot mismatch", () => {
    function Probe() {
      const phone = useIsBelow("md");
      const coarse = useMediaQuery(TOUCH_QUERY);
      return React.createElement("span", null, `${String(phone)}|${String(coarse)}`);
    }
    expect(renderToStaticMarkup(React.createElement(Probe))).toBe("<span>undefined|undefined</span>");
  });
});
