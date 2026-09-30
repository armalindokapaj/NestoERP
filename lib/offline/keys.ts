import { getPlatformServices } from "@/lib/device/registry";

import { generateKey, importKey, randomBytes } from "./crypto";
import { committed, openDatabase, request } from "./idb";

/**
 * Where the offline encryption key lives (MOB-09 §64).
 *
 * Native: 32 random bytes in the OS secure store (Keychain / Keystore-backed),
 * imported as a non-extractable key each launch. Browser: a non-extractable
 * CryptoKey kept in its own IndexedDB store — it cannot be read back out, but
 * it is not hardware-backed, which `docs/mobile/offline-security.md` states
 * plainly. One key per user, so two people on one device never share data.
 */

const KEY_DATABASE = "nesto-offline-keys";
const KEY_STORE = "keys";

const secureName = (userId: string) => `offline.key.${userId}`;

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function browserKey(userId: string, create: boolean, factory?: IDBFactory): Promise<CryptoKey | null> {
  const database = await openDatabase(KEY_DATABASE, 1, (db) => void db.createObjectStore(KEY_STORE), factory);
  try {
    const read = database.transaction(KEY_STORE, "readonly");
    const existing = (await request(read.objectStore(KEY_STORE).get(userId))) as CryptoKey | undefined;
    if (existing) return existing;
    if (!create) return null;
    const key = await generateKey();
    const write = database.transaction(KEY_STORE, "readwrite");
    write.objectStore(KEY_STORE).put(key, userId);
    await committed(write);
    return key;
  } finally {
    database.close();
  }
}

/** The user's key, created on first use. */
export async function databaseKey(userId: string, factory?: IDBFactory): Promise<CryptoKey> {
  const secure = getPlatformServices().secureStorage;
  if (secure.available) {
    const stored = await secure.get(secureName(userId));
    if (stored) return importKey(fromBase64(stored));
    const raw = randomBytes(32);
    await secure.set(secureName(userId), toBase64(raw));
    return importKey(raw);
  }
  return (await browserKey(userId, true, factory))!;
}

/** Destroys the key. The sealed data becomes unreadable for good — used only when the user discards an account's offline data. */
export async function destroyKey(userId: string, factory?: IDBFactory): Promise<void> {
  const secure = getPlatformServices().secureStorage;
  if (secure.available) await secure.remove(secureName(userId));
  const database = await openDatabase(KEY_DATABASE, 1, (db) => void db.createObjectStore(KEY_STORE), factory);
  try {
    const write = database.transaction(KEY_STORE, "readwrite");
    write.objectStore(KEY_STORE).delete(userId);
    await committed(write);
  } finally {
    database.close();
  }
}
