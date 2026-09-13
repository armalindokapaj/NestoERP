import { Socket } from "node:net";

import { registerFileScanner, type FileScanInput, type FileScanner, type FileScanResult } from "./scanner";

/**
 * ClamAV over clamd's INSTREAM protocol (PRD #38 §99, §100).
 *
 * The file is streamed to a clamd service in length-prefixed chunks; clamd
 * answers `stream: OK`, `stream: <signature> FOUND`, or an error. Anything that
 * is not an explicit OK or FOUND — a refused connection, a timeout, a size
 * limit, a reply this code does not recognise — is ERROR, and ERROR never makes
 * a file available: the gate fails closed (PRD #29 §59).
 *
 * Configuration: CLAMAV_HOST, CLAMAV_PORT (3310), CLAMAV_TIMEOUT_MS (30000).
 * The signature name goes to the audit trail and logs only, never to a user.
 */

const CHUNK_BYTES = 64 * 1024;

export type ClamAvOptions = { host: string; port: number; timeoutMs: number };

export function clamAvOptionsFromEnv(env: Record<string, string | undefined> = process.env): ClamAvOptions | null {
  const host = env.CLAMAV_HOST?.trim();
  if (!host) return null;
  const port = Number(env.CLAMAV_PORT ?? 3310);
  const timeoutMs = Number(env.CLAMAV_TIMEOUT_MS ?? 30_000);
  return {
    host,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3310,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 ? timeoutMs : 30_000,
  };
}

/** Reads clamd's reply into a verdict. Exported for tests. */
export function parseClamdReply(reply: string): FileScanResult {
  const text = reply.replace(/\0/g, "").trim();
  if (/^stream: OK$/i.test(text)) return { verdict: "CLEAN" };
  const found = /^stream: (.+) FOUND$/i.exec(text);
  if (found) return { verdict: "INFECTED", detail: found[1].slice(0, 200) };
  return { verdict: "ERROR", detail: text.slice(0, 200) || "empty reply" };
}

export class ClamAvFileScanner implements FileScanner {
  readonly provider = "clamav";

  constructor(private readonly options: ClamAvOptions | null) {}

  async scan(input: FileScanInput): Promise<FileScanResult> {
    // Named as the scanner but not pointed at one: every file waits, loudly.
    if (!this.options) return { verdict: "ERROR", detail: "CLAMAV_HOST is not configured" };

    const bytes = await input.read();
    if (bytes === null) return { verdict: "ERROR", detail: "object unreadable" };

    return this.instream(bytes);
  }

  private instream(bytes: Uint8Array): Promise<FileScanResult> {
    const { host, port, timeoutMs } = this.options!;

    return new Promise((resolve) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (result: FileScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs, () => finish({ verdict: "ERROR", detail: "clamd timed out" }));
      socket.on("error", (error) => finish({ verdict: "ERROR", detail: `clamd unreachable: ${error.message}` }));
      socket.on("data", (data) => {
        chunks.push(data);
        // clamd ends its reply with a NUL in the z-prefixed protocol.
        if (data.includes(0)) finish(parseClamdReply(Buffer.concat(chunks).toString("utf8")));
      });
      socket.on("end", () => finish(parseClamdReply(Buffer.concat(chunks).toString("utf8"))));

      socket.connect(port, host, () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
          const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length));
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length, 0);
          socket.write(length);
          socket.write(chunk);
        }
        // A zero-length chunk ends the stream.
        socket.write(Buffer.alloc(4));
      });
    });
  }
}

registerFileScanner("clamav", () => new ClamAvFileScanner(clamAvOptionsFromEnv()));
