/**
 * Service boundaries between NESTO's UI and the device (MOB-08 §17, §18).
 * Each has a web adapter (`web.ts`) and a native adapter (`native/`). A
 * component imports `getPlatformServices()`, never Capacitor.
 */
import type { CaptureService } from "@/lib/field/capture-service";
import type { PlatformName } from "./platform";

export type { CaptureService };

export interface PlatformService {
  readonly platform: PlatformName;
  readonly isNative: boolean;
  /** Installed binary version, e.g. "1.0.0"; null on the web. */
  appVersion(): Promise<{ version: string; build: string } | null>;
}

export interface ShareService {
  readonly available: boolean;
  /** Opens the system share sheet. Resolves false if the user dismissed it. */
  shareLink(input: { title?: string; url: string }): Promise<boolean>;
  shareFile(input: { title?: string; file: File }): Promise<boolean>;
}

export interface FileService {
  /** Save/open a Blob the page already holds through the platform's mechanism. */
  saveOrOpen(input: { file: File }): Promise<void>;
}

export interface SecureStorageService {
  readonly available: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export type PushRegistration = { token: string; platform: "ios" | "android" };
export type PushPermission = "granted" | "denied" | "prompt" | "unsupported";

export interface NotificationService {
  readonly available: boolean;
  permission(): Promise<PushPermission>;
  /** Asks the OS (only when the user chose to enable notifications) and returns the device token. */
  register(): Promise<PushRegistration | null>;
  unregister(): Promise<void>;
  /** Called with the canonical path (`/tasks/:id`) when a notification is tapped. */
  onOpen(listener: (path: string) => void): () => void;
}

export interface BiometricService {
  readonly available: boolean;
  isEnrolled(): Promise<boolean>;
  /** True only when the OS confirmed the person. Never throws for "failed" or "unavailable". */
  authenticate(reason: string): Promise<boolean>;
}

export type NetworkState = { online: boolean };

export interface AppLifecycleService {
  onResume(listener: () => void): () => void;
  onBackground(listener: () => void): () => void;
  onNetworkChange(listener: (state: NetworkState) => void): () => void;
  /** A NESTO URL the OS handed to the app (Universal/App Link). */
  onOpenUrl(listener: (url: string) => void): () => void;
  /** Android hardware Back. Return true from the handler when it consumed the press. */
  onBack(listener: (canGoBack: boolean) => void): () => void;
  exitApp(): Promise<void>;
  hideSplash(): Promise<void>;
  setStatusBar(theme: "light" | "dark"): Promise<void>;
}

export interface ExternalLinkService {
  /** Sends a non-NESTO URL to the right handler. Returns false when the URL is refused. */
  open(url: string): Promise<boolean>;
}

export interface PlatformServices {
  platform: PlatformService;
  capture: CaptureService;
  files: FileService;
  share: ShareService;
  secureStorage: SecureStorageService;
  notifications: NotificationService;
  biometrics: BiometricService;
  lifecycle: AppLifecycleService;
  externalLinks: ExternalLinkService;
}
