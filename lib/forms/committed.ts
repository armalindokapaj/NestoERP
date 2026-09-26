/**
 * What an editor's server action answers once its change has committed
 * (AUD-03 §6).
 *
 * An action that calls `redirect()` moves the router before the form learns
 * anything: the form cannot tell the save succeeded, and "Save and continue"
 * could not go where the person was going. So an editor's action answers the
 * record it saved instead, and the form navigates — to this destination after
 * an ordinary save, or to the person's own destination after Save and continue.
 */
export type Committed = { ok: true; redirectTo?: string };

export function committed(redirectTo?: string): Committed {
  return redirectTo ? { ok: true, redirectTo } : { ok: true };
}
