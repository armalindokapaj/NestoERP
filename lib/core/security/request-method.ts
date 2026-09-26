/**
 * The HTTP method an API route was called with, as middleware saw it
 * (AUD-06 §3, gap 13).
 *
 * `withContext` has no request object, so it reads the method from a header
 * middleware sets. Middleware does not run on paths that look like static
 * files, and a dynamic segment can be spelled `abc.png`: on such a path a
 * client's own header would pass straight through. So middleware also signs
 * method and path with the auth secret, and the method is believed only when
 * the signature holds. An unverified method is treated as a write — the
 * stricter reading for every guard that asks (Group workspace writes, the
 * stale-tab refusal, read-only maintenance).
 *
 * Web Crypto on both sides: the same code runs in the edge middleware and in
 * the Node route.
 */
export const REQUEST_METHOD_HEADER = "x-nesto-request-method";
export const REQUEST_SIGNATURE_HEADER = "x-nesto-request-signature";
/** What an unverified method reads as: not GET, HEAD or OPTIONS. */
export const UNVERIFIED_METHOD = "UNVERIFIED";

function secret(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

async function hmac(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Middleware: the signature for this method and path, or null without a secret. */
export async function signRequestMethod(method: string, path: string): Promise<string | null> {
  const key = secret();
  return key ? hmac(key, `${method.toUpperCase()} ${path}`) : null;
}

/**
 * The route: the method, when middleware's signature over it and the path
 * holds; otherwise `UNVERIFIED`. Without a secret (a developer's machine with
 * none configured) the header is believed, as before.
 */
export async function verifiedRequestMethod(headers: Pick<Headers, "get">, path: string): Promise<string> {
  const method = headers.get(REQUEST_METHOD_HEADER);
  const key = secret();
  if (!key) return method ?? "GET";
  const signature = headers.get(REQUEST_SIGNATURE_HEADER);
  if (!method || !signature) return UNVERIFIED_METHOD;
  const expected = await hmac(key, `${method.toUpperCase()} ${path}`);
  if (expected.length !== signature.length) return UNVERIFIED_METHOD;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0 ? method.toUpperCase() : UNVERIFIED_METHOD;
}
