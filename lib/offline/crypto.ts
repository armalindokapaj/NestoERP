/**
 * Encryption of offline records (MOB-09 §63, §64).
 *
 * AES-GCM-256 through WebCrypto. A sealed value carries its own random IV; the
 * key never appears in this file or in any bundle — it comes from `keys.ts`.
 * Identifiers and sync states that must be indexed stay in the clear in the
 * store; business content (payloads, names, photo bytes) is sealed.
 */

export type Sealed = { v: 1; iv: Uint8Array; ct: ArrayBuffer };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("This device cannot encrypt offline data.");
  return api;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export async function generateKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Imports raw key material as a non-extractable key, so script cannot read it back out. */
export async function importKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function seal(key: CryptoKey, bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { v: 1, iv, ct };
}

export async function open(key: CryptoKey, sealed: Sealed): Promise<ArrayBuffer> {
  return subtle().decrypt({ name: "AES-GCM", iv: sealed.iv as Uint8Array<ArrayBuffer> }, key, sealed.ct);
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<Sealed> {
  return seal(key, encoder.encode(JSON.stringify(value)));
}

export async function openJson<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  return JSON.parse(decoder.decode(await open(key, sealed))) as T;
}
