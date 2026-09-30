import type { CapacitorConfig } from "@capacitor/cli";

import version from "./native/version.json";
import { allowedNavigationHosts, resolveNativeOrigin } from "./native/origins";

/**
 * Native shell configuration (MOB-08). Runtime: hosted shell — the WebView
 * loads the canonical NESTO origin (docs/mobile/MOB-08-native-readiness-audit.md §2).
 * `webDir` only holds the offline fallback page shown when that origin cannot
 * be reached. Choose the environment with NESTO_NATIVE_ENV before `cap sync`.
 */
const { environment, origin } = resolveNativeOrigin(process.env);

const config: CapacitorConfig = {
  // Permanent once published: change only with an explicit product decision.
  appId: "com.nesto.erp",
  appName: "NESTO",
  webDir: "native/www",
  server: {
    url: origin,
    // Only the development build may speak plain http (a local dev server).
    cleartext: environment === "development" && origin.startsWith("http://"),
    allowNavigation: allowedNavigationHosts(origin),
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "never",
    scheme: "NESTO",
    // The server reads this to gate obsolete binaries (lib/device/compatibility.ts).
    appendUserAgent: `NESTOApp/${version.version} (ios; build ${version.iosBuild})`,
  },
  android: {
    appendUserAgent: `NESTOApp/${version.version} (android; build ${version.androidBuild})`,
    allowMixedContent: false,
    webContentsDebuggingEnabled: environment !== "production",
  },
  plugins: {
    // Hides as soon as the page is ready (and on the offline page): no artificial delay (§60).
    SplashScreen: { launchAutoHide: true, launchFadeOutDuration: 150, backgroundColor: "#15171c" },
    Keyboard: { resize: "native", resizeOnFullScreen: true },
    StatusBar: { overlaysWebView: true },
  },
};

export default config;
