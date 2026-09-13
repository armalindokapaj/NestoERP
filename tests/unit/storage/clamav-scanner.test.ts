import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClamAvFileScanner, clamAvOptionsFromEnv, parseClamdReply } from "@/lib/core/storage/clamav-scanner";
import { fileScanner } from "@/lib/core/storage/scanner";

/**
 * The ClamAV adapter (PRD #38 §99, §100): a real clamd conversation against a
 * stand-in server, and the rule that anything short of an explicit OK is not
 * clean.
 */

let server: Server;
let port = 0;
const received: Buffer[] = [];

beforeAll(async () => {
  server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      const command = "zINSTREAM\0";
      if (buffer.length < command.length + 4) return;
      if (buffer.subarray(0, command.length).toString() !== command) {
        socket.end("UNKNOWN COMMAND\0");
        return;
      }
      // Walk the length-prefixed chunks until the zero-length terminator.
      let offset = command.length;
      const payload: Buffer[] = [];
      while (offset + 4 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        if (length === 0) {
          const body = Buffer.concat(payload);
          received.push(body);
          const text = body.toString("latin1");
          if (text.includes("SLOW")) return; // never answer: exercises the timeout
          socket.end(text.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : text.includes("BROKEN") ? "INSTREAM size limit exceeded. ERROR\0" : "stream: OK\0");
          return;
        }
        if (offset + 4 + length > buffer.length) return;
        payload.push(buffer.subarray(offset + 4, offset + 4 + length));
        offset += 4 + length;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const input = (text: string) => ({
  storageKey: "k",
  fileName: "f.txt",
  sizeBytes: text.length,
  read: async () => new TextEncoder().encode(text),
});

describe("ClamAV scanner", () => {
  it("streams the whole file and trusts an explicit OK", async () => {
    const scanner = new ClamAvFileScanner({ host: "127.0.0.1", port, timeoutMs: 5000 });
    const big = "a".repeat(200_000);
    expect(await scanner.scan(input(big))).toEqual({ verdict: "CLEAN" });
    expect(received.at(-1)?.length).toBe(200_000);
  });

  it("reports a signature as infected, with the name kept for the logs", async () => {
    const scanner = new ClamAvFileScanner({ host: "127.0.0.1", port, timeoutMs: 5000 });
    expect(await scanner.scan(input("EICAR payload"))).toEqual({ verdict: "INFECTED", detail: "Eicar-Test-Signature" });
  });

  it("fails closed on an error reply, an unreachable service, a timeout or no configuration", async () => {
    const reachable = new ClamAvFileScanner({ host: "127.0.0.1", port, timeoutMs: 5000 });
    expect((await reachable.scan(input("BROKEN"))).verdict).toBe("ERROR");

    const slow = new ClamAvFileScanner({ host: "127.0.0.1", port, timeoutMs: 1000 });
    expect((await slow.scan(input("SLOW"))).verdict).toBe("ERROR");

    const closed = new ClamAvFileScanner({ host: "127.0.0.1", port: 1, timeoutMs: 1000 });
    expect((await closed.scan(input("anything"))).verdict).toBe("ERROR");

    expect((await new ClamAvFileScanner(null).scan(input("anything"))).verdict).toBe("ERROR");
    expect((await reachable.scan({ ...input("x"), read: async () => null })).verdict).toBe("ERROR");
  });

  it("reads replies strictly", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ verdict: "CLEAN" });
    expect(parseClamdReply("stream: Win.Test FOUND\0").verdict).toBe("INFECTED");
    expect(parseClamdReply("").verdict).toBe("ERROR");
    expect(parseClamdReply("stream: OK maybe").verdict).toBe("ERROR");
  });

  it("is what STORAGE_SCANNER=clamav selects, even before a host is set", () => {
    const previous = { scanner: process.env.STORAGE_SCANNER, host: process.env.CLAMAV_HOST };
    process.env.STORAGE_SCANNER = "clamav";
    delete process.env.CLAMAV_HOST;
    try {
      expect(fileScanner()?.provider).toBe("clamav");
      // An engine nobody registered is still a scanner, and it never says clean.
      process.env.STORAGE_SCANNER = "some-engine";
      expect(fileScanner()?.provider).toBe("some-engine");
      process.env.STORAGE_SCANNER = "clamav";
      expect(clamAvOptionsFromEnv()).toBeNull();
      expect(clamAvOptionsFromEnv({ CLAMAV_HOST: "clamd", CLAMAV_PORT: "3310" })).toEqual({ host: "clamd", port: 3310, timeoutMs: 30_000 });
    } finally {
      process.env.STORAGE_SCANNER = previous.scanner;
      if (previous.host) process.env.CLAMAV_HOST = previous.host;
      if (previous.scanner === undefined) delete process.env.STORAGE_SCANNER;
    }
  });

  it("never calls a file clean when the named engine is not loaded", async () => {
    const previous = process.env.STORAGE_SCANNER;
    process.env.STORAGE_SCANNER = "some-engine";
    try {
      expect((await fileScanner()!.scan(input("anything"))).verdict).toBe("ERROR");
    } finally {
      if (previous === undefined) delete process.env.STORAGE_SCANNER;
      else process.env.STORAGE_SCANNER = previous;
    }
  });
});
