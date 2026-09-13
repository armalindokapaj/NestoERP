import { ClamAvFileScanner, clamAvOptionsFromEnv } from "./clamav-scanner";

/**
 * The malware scanner seam (PRD #29 §54, §57, §58).
 *
 * NESTO does not bundle an antivirus engine. What it provides is the contract a
 * deployment plugs one into — ClamAV over clamd's INSTREAM protocol ships with
 * it (clamav-scanner.ts) — and the two behaviours that matter whether or not an
 * engine is present:
 *
 *   with no scanner configured a file records NOT_REQUIRED — deliberately not
 *   CLEAN, because nothing looked at it (§56)
 *
 *   with a scanner configured a file does not become AVAILABLE until the
 *   verdict is CLEAN, and a scanner that is unreachable leaves it pending
 *   rather than waving it through (§55, §59)
 *
 * The EICAR scanner below is a real implementation of that contract against
 * the standard, harmless antivirus test signature, which is what §373 asks the
 * tests to use. It is what makes the malware path exercisable end to end
 * without a live engine or live malware.
 */

export type FileScanInput = {
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  /** Reads the object. Streaming is the scanner's business, not the caller's. */
  read: () => Promise<Uint8Array | null>;
};

export type FileScanResult = {
  verdict: "CLEAN" | "INFECTED" | "ERROR";
  /**
   * Internal detail for the logs only. It must never reach a user-facing
   * message (PRD #29 §211).
   */
  detail?: string;
};

export interface FileScanner {
  readonly provider: string;
  scan(input: FileScanInput): Promise<FileScanResult>;
}

/**
 * The EICAR test file, split so this source file is not itself flagged by a
 * desktop antivirus scanning the repository.
 */
const EICAR_SIGNATURE = [
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-",
  "ANTIVIRUS-TEST-FILE!$H+H*",
].join("");

/** A scanner that recognises exactly one thing: the industry test signature. */
export class EicarFileScanner implements FileScanner {
  readonly provider = "eicar-test";

  async scan(input: FileScanInput): Promise<FileScanResult> {
    const bytes = await input.read();
    // A file the scanner cannot read is an error, not a pass. Failing open
    // here would defeat the entire gate (PRD #29 §59, §375).
    if (bytes === null) return { verdict: "ERROR", detail: "object unreadable" };

    const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
    if (head.includes(EICAR_SIGNATURE)) {
      return { verdict: "INFECTED", detail: "EICAR-Test-File" };
    }
    return { verdict: "CLEAN" };
  }
}

/**
 * Chooses the configured scanner, or none (PRD #29 §58).
 *
 * Returning null is a real answer with real consequences: the upload pipeline
 * records NOT_REQUIRED and skips the SCANNING state entirely, which is the
 * V0.1 simplified flow of §13.
 */
export function fileScanner(): FileScanner | null {
  const configured = (process.env.STORAGE_SCANNER ?? "none").toLowerCase();
  if (configured === "eicar") return new EicarFileScanner();
  // A production engine (PRD #38 §99). Named but unconfigured still returns a
  // scanner — one whose every verdict is ERROR — so a missing host holds files
  // back instead of quietly skipping the scan.
  if (configured === "clamav") return new ClamAvFileScanner(clamAvOptionsFromEnv());
  return null;
}

/** Test seam: `null` means "no scanner", `undefined` means "read the env". */
let override: FileScanner | null | undefined;

export function setFileScanner(scanner: FileScanner | null | undefined): void {
  override = scanner;
}

export function activeScanner(): FileScanner | null {
  return override === undefined ? fileScanner() : override;
}

/**
 * Whether a scanner is in play.
 *
 * Deliberately routed through `activeScanner` rather than `fileScanner`: the
 * upload pipeline asks this question to decide whether a file must wait for a
 * verdict, and a gate that read the environment while the scanner came from
 * the override would answer for a different scanner than the one that runs.
 */
export function scannerEnabled(): boolean {
  return activeScanner() !== null;
}
