/**
 * Web adapters: what each platform service does in a browser (MOB-08 §18).
 * Capabilities a browser lacks report `available: false`; the UI hides the
 * control rather than calling into a no-op.
 */
import { webCaptureService } from "@/lib/field/capture-service";
import { classifyLink } from "./links";
import type { PlatformServices } from "./types";

const noop = () => undefined;

export function createWebServices(): PlatformServices {
  return {
    platform: { platform: "web", isNative: false, appVersion: async () => null },
    capture: webCaptureService,
    files: {
      async saveOrOpen({ file }) {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      },
    },
    share: {
      get available() {
        return typeof navigator !== "undefined" && typeof navigator.share === "function";
      },
      async shareLink({ title, url }) {
        if (typeof navigator.share !== "function") return false;
        try {
          await navigator.share({ title, url });
          return true;
        } catch {
          return false;
        }
      },
      async shareFile({ title, file }) {
        if (typeof navigator.canShare !== "function" || !navigator.canShare({ files: [file] })) return false;
        try {
          await navigator.share({ title, files: [file] });
          return true;
        } catch {
          return false;
        }
      },
    },
    secureStorage: {
      // A browser has no OS-backed secret store. localStorage is not one (§24).
      available: false,
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      clear: async () => undefined,
    },
    notifications: {
      available: false,
      permission: async () => "unsupported",
      register: async () => null,
      unregister: async () => undefined,
      onOpen: () => noop,
      onReceive: () => noop,
    },
    biometrics: { available: false, isEnrolled: async () => false, authenticate: async () => false },
    lifecycle: {
      onResume(listener) {
        const handler = () => {
          if (document.visibilityState === "visible") listener();
        };
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
      },
      onBackground(listener) {
        const handler = () => {
          if (document.visibilityState === "hidden") listener();
        };
        document.addEventListener("visibilitychange", handler);
        return () => document.removeEventListener("visibilitychange", handler);
      },
      onNetworkChange(listener) {
        const on = () => listener({ online: true });
        const off = () => listener({ online: false });
        window.addEventListener("online", on);
        window.addEventListener("offline", off);
        return () => {
          window.removeEventListener("online", on);
          window.removeEventListener("offline", off);
        };
      },
      onOpenUrl: () => noop,
      onBack: () => noop,
      exitApp: async () => undefined,
      hideSplash: async () => undefined,
      setStatusBar: async () => undefined,
    },
    externalLinks: {
      async open(url) {
        const kind = classifyLink(url, window.location.origin);
        if (kind === "blocked") return false;
        if (kind === "internal") {
          window.location.assign(url);
          return true;
        }
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      },
    },
  };
}
