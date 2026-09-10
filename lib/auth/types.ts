/**
 * What the signed session cookie carries (PRD #6 §26).
 *
 * Deliberately minimal: identity plus the session id. Permissions, role and
 * company are resolved server-side on every request from the database, so a
 * stale or tampered cookie can never widen access (PRD #6 §27).
 */
export type NestoSessionUser = {
  id: string;
  email: string;
  sessionId: string;
};
