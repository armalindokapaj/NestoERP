/**
 * Native adapters (MOB-08 §17, §18, §38-§41, §44-§47). Loaded only inside the
 * Capacitor shell, via a dynamic import from `installNativeServices`, so the
 * plugin code never reaches a browser bundle. Every plugin here is listed,
 * with its purpose, in docs/mobile/native-capability-matrix.md.
 */
import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Camera } from "@capacitor/camera";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Network } from "@capacitor/network";
import { PushNotifications } from "@capacitor/push-notifications";
import { Share } from "@capacitor/share";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { FilePicker } from "@capawesome/capacitor-file-picker";

import { CaptureError, type CapturedFile, type CaptureService } from "@/lib/field/capture-service";
import { classifyLink, safePushPath } from "../links";
import { getPlatform } from "../platform";
import type { PlatformServices } from "../types";

const STORAGE_PREFIX = "nesto.";

function base64ToFile(base64: string, name: string, type: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type });
}

/** Reads a file the OS gave us by path. Not `convertFileSrc`: the page is served from the remote origin, whose CSP and scheme do not reach local files. */
async function readNativeFile(path: string, name: string, type: string): Promise<File> {
  const { data } = await Filesystem.readFile({ path });
  return typeof data === "string" ? base64ToFile(data, name, type) : new File([data], name, { type });
}

const listen = (handle: Promise<PluginListenerHandle>) => () => void handle.then((h) => h.remove());

let captureCounter = 0;
const captureId = () => `cap-n-${Date.now().toString(36)}-${(captureCounter += 1)}`;
const cancelled = (error: unknown) => /cancel/i.test(String((error as Error)?.message ?? error));
const denied = (error: unknown) => /denied|permission|not authorized/i.test(String((error as Error)?.message ?? error));

const nativeCapture: CaptureService = {
  supportsCamera: true,
  async capturePhoto() {
    try {
      const result = await Camera.takePhoto({ quality: 85, saveToGallery: false, correctOrientation: true });
      if (!result.uri) return null;
      const file = await readNativeFile(result.uri, `photo-${Date.now()}.jpg`, "image/jpeg");
      return { id: captureId(), file, source: "camera" };
    } catch (error) {
      if (cancelled(error)) return null;
      if (denied(error)) throw new CaptureError("PERMISSION_DENIED");
      throw new CaptureError("UNAVAILABLE");
    }
  },
  async selectPhotos(options) {
    try {
      const { files } = await FilePicker.pickImages({ limit: options?.multiple === false ? 1 : 0 });
      return await toCaptured(files, "library");
    } catch (error) {
      if (cancelled(error)) return [];
      if (denied(error)) throw new CaptureError("PERMISSION_DENIED");
      throw new CaptureError("UNAVAILABLE");
    }
  },
  async selectFiles(options) {
    try {
      const types = options?.accept?.split(",").map((t) => t.trim()).filter((t) => t.includes("/") && !t.endsWith("*"));
      const { files } = await FilePicker.pickFiles({ limit: options?.multiple === false ? 1 : 0, types: types?.length ? types : undefined });
      return await toCaptured(files, "files");
    } catch (error) {
      if (cancelled(error)) return [];
      throw new CaptureError("UNAVAILABLE");
    }
  },
};

async function toCaptured(
  picked: Array<{ path?: string; blob?: Blob; name: string; mimeType: string }>,
  source: CapturedFile["source"],
): Promise<CapturedFile[]> {
  const out: CapturedFile[] = [];
  for (const item of picked) {
    const file = item.blob ? new File([item.blob], item.name, { type: item.mimeType }) : item.path ? await readNativeFile(item.path, item.name, item.mimeType) : null;
    if (file) out.push({ id: captureId(), file, source });
  }
  return out;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

/** Writes bytes to the app cache and opens the share sheet for them (Save to Files, Open in…, AirDrop). */
async function shareFileNatively(file: File, title?: string): Promise<boolean> {
  const path = `share/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
  const written = await Filesystem.writeFile({ path, data: await blobToBase64(file), directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title, files: [written.uri] });
    return true;
  } catch (error) {
    if (cancelled(error)) return false;
    throw error;
  } finally {
    void Filesystem.deleteFile({ path: written.uri }).catch(() => undefined);
  }
}

export function createNativeServices(appOrigin: string): PlatformServices {
  const platform = getPlatform();
  if (platform === "web") throw new Error("createNativeServices called outside the native shell");

  return {
    platform: {
      platform,
      isNative: true,
      async appVersion() {
        const info = await App.getInfo();
        return { version: info.version, build: info.build };
      },
    },
    capture: nativeCapture,
    files: { saveOrOpen: async ({ file }) => void (await shareFileNatively(file, file.name)) },
    share: {
      available: true,
      async shareLink({ title, url }) {
        try {
          await Share.share({ title, url });
          return true;
        } catch {
          return false;
        }
      },
      shareFile: ({ title, file }) => shareFileNatively(file, title),
    },
    secureStorage: {
      available: true,
      async get(key) {
        const value = await SecureStorage.get(STORAGE_PREFIX + key, false);
        return typeof value === "string" ? value : null;
      },
      set: async (key, value) => void (await SecureStorage.set(STORAGE_PREFIX + key, value, false)),
      remove: async (key) => void (await SecureStorage.remove(STORAGE_PREFIX + key)),
      async clear() {
        // The offline encryption keys stay: signing out must not make unsynced work unreadable (MOB-09 §10, §97).
        // They are removed only when the person discards an account's offline data (`destroyKey`).
        for (const key of await SecureStorage.keys()) {
          if (key.startsWith(STORAGE_PREFIX) && !key.startsWith(`${STORAGE_PREFIX}offline.key.`)) await SecureStorage.remove(key);
        }
      },
    },
    notifications: {
      available: true,
      async permission() {
        const { receive } = await PushNotifications.checkPermissions();
        return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
      },
      async register() {
        // Only called from the "turn on notifications" action, never at startup (§82).
        const { receive } = await PushNotifications.requestPermissions();
        if (receive !== "granted") return null;
        // Android notification channels (MOB-10 §32, §188): four, matching the ids the server sends.
        // People can change each one in system settings; the server never assumes they have not.
        if (platform === "android") {
          const channels = [
            { id: "general", name: "General", description: "Everyday NESTO updates", importance: 3 },
            { id: "tasks_mentions", name: "Tasks & mentions", description: "Tasks assigned to you and people mentioning you", importance: 4 },
            { id: "approvals", name: "Approvals", description: "Approvals waiting for your decision", importance: 4 },
            { id: "critical_hse", name: "Critical safety alerts", description: "Critical HSE alerts", importance: 5 },
          ] as const;
          await Promise.all(channels.map((channel) => PushNotifications.createChannel({ ...channel, visibility: 0 }).catch(() => undefined)));
        }
        const token = new Promise<string | null>((resolve) => {
          void PushNotifications.addListener("registration", (t) => resolve(t.value));
          void PushNotifications.addListener("registrationError", () => resolve(null));
          setTimeout(() => resolve(null), 15_000);
        });
        await PushNotifications.register();
        const value = await token;
        return value ? { token: value, platform: platform as "ios" | "android" } : null;
      },
      async unregister() {
        await PushNotifications.unregister().catch(() => undefined);
        await PushNotifications.removeAllListeners().catch(() => undefined);
        await PushNotifications.removeAllDeliveredNotifications().catch(() => undefined);
      },
      onReceive(listener) {
        return listen(PushNotifications.addListener("pushNotificationReceived", () => listener()));
      },
      onOpen(listener) {
        return listen(
          PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
            const path = safePushPath((action.notification.data as { path?: unknown } | undefined)?.path);
            if (path) listener(path);
          }),
        );
      },
    },
    biometrics: {
      available: true,
      async isEnrolled() {
        try {
          return (await BiometricAuth.checkBiometry()).isAvailable;
        } catch {
          return false;
        }
      },
      async authenticate(reason) {
        try {
          await BiometricAuth.authenticate({ reason, allowDeviceCredential: true });
          return true;
        } catch {
          return false;
        }
      },
    },
    lifecycle: {
      onResume: (listener) => listen(App.addListener("resume", listener)),
      onBackground: (listener) => listen(App.addListener("pause", listener)),
      onNetworkChange(listener) {
        const handle = Network.addListener("networkStatusChange", (s) => listener({ online: s.connected }));
        return listen(handle);
      },
      onOpenUrl: (listener) => listen(App.addListener("appUrlOpen", (event) => listener(event.url))),
      onBack: (listener) => listen(App.addListener("backButton", ({ canGoBack }) => listener(canGoBack))),
      exitApp: () => App.exitApp(),
      hideSplash: () => SplashScreen.hide(),
      async setStatusBar(theme) {
        await StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light });
      },
    },
    externalLinks: {
      async open(url) {
        const kind = classifyLink(url, appOrigin);
        if (kind === "blocked") return false;
        if (kind === "internal") {
          window.location.assign(url);
          return true;
        }
        if (kind === "tel" || kind === "mailto") {
          window.location.href = url;
          return true;
        }
        await Browser.open({ url });
        return true;
      },
    },
  };
}

export async function deviceInfo(): Promise<{ platform: "ios" | "android"; model: string; osVersion: string }> {
  const info = await Device.getInfo();
  return { platform: info.platform as "ios" | "android", model: info.model, osVersion: info.osVersion };
}

export { Capacitor };
