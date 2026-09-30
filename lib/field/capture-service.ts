/**
 * CaptureService (MOB-07 §25, §26, §79-§82, §103, §105).
 *
 * Business components ask for a photo or a file; they never touch an `<input>`,
 * `window.webkit`, an Android bridge or Capacitor. The web adapter below uses a
 * file input with `capture` (the phone camera) or without (library, files). The
 * native shell (MOB-08) registers its own adapter with `setCaptureService` and
 * no Task, Site Diary or HSE component changes.
 *
 * Permissions follow the platform: the browser asks for the camera only when
 * `capturePhoto` is called, never at startup, and a denial or a cancelled
 * picker comes back as an empty result so the caller can offer "Choose file"
 * instead of trapping the workflow (§80-§82).
 */

export type CaptureSource = "camera" | "library" | "files";

export type CapturedFile = {
  /** Stable for the life of the capture, so a list can key and remove it. */
  id: string;
  file: File;
  source: CaptureSource;
};

/**
 * Thrown by an adapter that can tell a denied permission from a cancelled
 * picker (the native shell can; a browser file input cannot). The UI shows the
 * "enable access or choose a file" message and keeps the picker available.
 */
export class CaptureError extends Error {
  readonly code: "PERMISSION_DENIED" | "UNAVAILABLE";
  constructor(code: "PERMISSION_DENIED" | "UNAVAILABLE") {
    super(code);
    this.name = "CaptureError";
    this.code = code;
  }
}

export interface CaptureService {
  /** Whether a camera button makes sense here (a phone/tablet, or a native shell). */
  readonly supportsCamera: boolean;
  capturePhoto(): Promise<CapturedFile | null>;
  selectPhotos(options?: { multiple?: boolean }): Promise<CapturedFile[]>;
  selectFiles(options?: { accept?: string; multiple?: boolean }): Promise<CapturedFile[]>;
}

let counter = 0;
const nextId = () => `cap-${Date.now().toString(36)}-${(counter += 1)}`;

function pick(options: { accept?: string; multiple?: boolean; capture?: "environment" | "user" }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (options.accept) input.accept = options.accept;
    if (options.multiple) input.multiple = true;
    if (options.capture) input.setAttribute("capture", options.capture);
    // Attached and hidden: some iOS versions ignore a detached input.
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.setAttribute("aria-hidden", "true");
    input.tabIndex = -1;
    document.body.appendChild(input);
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => done([]), { once: true });
    input.click();
  });
}

const wrap = (files: File[], source: CaptureSource): CapturedFile[] => files.map((file) => ({ id: nextId(), file, source }));

export const webCaptureService: CaptureService = {
  get supportsCamera() {
    if (typeof window === "undefined") return false;
    // A coarse primary pointer is a touch device; desktop browsers have no camera sheet.
    return window.matchMedia("(pointer: coarse)").matches;
  },
  async capturePhoto() {
    const [file] = await pick({ accept: "image/*", capture: "environment" });
    return file ? wrap([file], "camera")[0] : null;
  },
  async selectPhotos(options) {
    return wrap(await pick({ accept: "image/*", multiple: options?.multiple ?? true }), "library");
  },
  async selectFiles(options) {
    return wrap(await pick({ accept: options?.accept, multiple: options?.multiple ?? true }), "files");
  },
};

let active: CaptureService = webCaptureService;

export function getCaptureService(): CaptureService {
  return active;
}

/** The native shell installs its adapter here (MOB-08). */
export function setCaptureService(service: CaptureService): void {
  active = service;
}
