import path from "node:path";

import { LocalStorageProvider } from "./providers/local.provider";
import { S3StorageProvider } from "./providers/s3.provider";
import { SupabaseStorageProvider, supabaseStorageBaseUrl } from "./providers/supabase.provider";
import type { StorageProvider } from "./storage-provider";

/**
 * Provider selection (PRD #29 §114, §115, §356).
 *
 * All of it is deployment configuration read from the environment. Nothing
 * here is a company setting: storage credentials must never live in the
 * database (PRD #29 §113).
 *
 *   STORAGE_DRIVER=local     filesystem, for development, test and CI
 *   STORAGE_DRIVER=s3        any S3-compatible private bucket
 *   STORAGE_DRIVER=supabase  a private Supabase Storage bucket, with the
 *                            project URL and server key the Supabase
 *                            integration already provides
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
    const endpoint = required("STORAGE_ENDPOINT", driver);
    requireHttpsInProduction(endpoint);

    return new S3StorageProvider({
      endpoint,
      region: process.env.STORAGE_REGION ?? "auto",
      bucket: required("STORAGE_BUCKET", driver),
      accessKeyId: required("STORAGE_ACCESS_KEY_ID", driver),
      secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY", driver),
      sessionToken: process.env.STORAGE_SESSION_TOKEN,
      forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== "false",
    });
  }

  if (driver === "supabase") {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) throw new Error("SUPABASE_URL is required when STORAGE_DRIVER=supabase.");
    // The newer secret key first; the legacy service_role JWT still works until Supabase retires it.
    const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required when STORAGE_DRIVER=supabase.");
    const storageUrl = process.env.SUPABASE_STORAGE_URL || undefined;
    requireHttpsInProduction(supabaseStorageBaseUrl({ url, storageUrl }));

    return new SupabaseStorageProvider({ url, serviceKey, bucket: required("STORAGE_BUCKET", driver), storageUrl });
  }

  // No base URL: the signed object URL is root-relative, so the browser
  // resolves it against its own origin (see `LocalStorageProvider`).
  return new LocalStorageProvider({
    root: process.env.DOCUMENT_STORAGE_ROOT ?? path.join(process.cwd(), ".storage"),
  });
}

// A signed URL must never be issued over plain HTTP in production
// (PRD #29 §185, §186).
function requireHttpsInProduction(endpoint: string): void {
  if (productionClass(process.env) && !endpoint.startsWith("https://")) {
    throw new Error("Object storage must be reached over HTTPS in production.");
  }
}

/**
 * `appEnvironment() === "production"` without validating the rest of the
 * environment: a variable storage never reads (NEXT_PUBLIC_APP_URL, say) must
 * not take every upload and download down with it.
 */
function productionClass(env: NodeJS.ProcessEnv): boolean {
  if (env.APP_ENV) return env.APP_ENV === "production" || env.APP_ENV === "demo";
  return env.NODE_ENV === "production";
}

function required(name: string, driver: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=${driver}.`);
  return value;
}

/** Test seam: lets a suite point storage at a temporary directory. */
export function setStorageProvider(provider: StorageProvider | null): void {
  cached = provider;
}
