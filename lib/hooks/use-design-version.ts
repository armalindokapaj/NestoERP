"use client";

import * as React from "react";

/**
 * Whether the page is drawn in version 2 of the design system (UI-02 §33).
 *
 * False on the server and on the first client render, like `useMediaQuery`
 * beside it, so it must only drive what has no place in the server's HTML: an
 * effect, a measurement, a tooltip. What a version looks like is decided in
 * CSS (`ds2:`, styles/tokens-v2.css). It follows the attribute, so the
 * development switch between versions needs no reload.
 */
export function useDesignVersion2(): boolean {
  return React.useSyncExternalStore(subscribeToDesignVersion, readDesignVersion2, () => false);
}

function subscribeToDesignVersion(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ds"] });
  return () => observer.disconnect();
}

function readDesignVersion2(): boolean {
  return document.documentElement.dataset.ds === "2";
}
