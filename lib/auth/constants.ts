/**
 * Authentication constants shared by the edge and Node halves of the auth
 * configuration.
 *
 * Kept apart from session-store.ts because middleware imports the edge config,
 * and that file uses node:crypto — which the edge runtime cannot load.
 */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // one eight-hour working day
