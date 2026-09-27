"use client";

import { useEffect } from "react";

/**
 * Registers the viewer's static-asset cache (public/sw-3d-cache.js) for this
 * one viewer page. Best effort: without service workers the viewer simply
 * loads from the network.
 */
export function use3DAssetCache(scope: string) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw-3d-cache.js", { scope }).catch((err) => {
      console.warn("3D asset cache: Service Worker registration failed", err);
    });
  }, [scope]);
}
