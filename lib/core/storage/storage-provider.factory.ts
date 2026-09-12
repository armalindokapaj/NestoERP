import path from "node:path";

import { appEnvironment } from "@/lib/config/env";
import { LocalStorageProvider } from "./providers/local.provider";
import { S3StorageProvider } from "./providers/s3.provider";
import type { StorageProvider } from "./storage-provider";

/**
 * Provider selection (PRD #29 §114, §115, §356).
 *
 * All of it is deployment configuration read from the environment. Nothing
 * here is a company setting: storage credentials must never live in the
 * database (PRD #29 §113).
 *
 *   STORAGE_DRIVER=local   filesystem, for development, test and CI
 *   STORAGE_DRIVER=s3      any S3-compatible private bucket
 *
 * Production refuses `local` — `lib/config/env.ts` fails the process at start
 * rather than letting a deployment discover it on the first upload.
 */

let cached: StorageProvider | null = null;

export function storageProvider(): StorageProvider {
  if (cached) return cached;
  cached = buildProvider();
  return cached;
}

function buildProvider(): StorageProvider {
  const driver = process.env.STORAGE_DRIVER ?? "local";

  if (driver === "s3") {
    const endpoint = required("STORAGE_ENDPOINT");
    const environment = appEnvironment();

    // A signed URL must never be issued over plain HTTP in production
    // (PRD #29 §185, §186).
    if (environment === "production" && !endpoint.startsWith("https://")) {
      throw new Error("Object storage must be reached over HTTPS in production.");
    }

    return new S3StorageProvider({
      endpoint,
      region: process.env.STORAGE_REGION ?? "auto",
      bucket: required("STORAGE_BUCKET"),
      accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
      sessionToken: process.env.STORAGE_SESSION_TOKEN,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== "false",
    });
  }

  // No base URL: the signed object URL is root-relative, so the browser
  // resolves it against its own origin (see `LocalStorageProvider`).
  return new LocalStorageProvider({
    root: process.env.DOCUMENT_STORAGE_ROOT ?? path.join(process.cwd(), ".storage"),
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=s3.`);
  return value;
}

/** Test seam: lets a suite point storage at a temporary directory. */
export function setStorageProvider(provider: StorageProvider | null): void {
  cached = provider;
}
