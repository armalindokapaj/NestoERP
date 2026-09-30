"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Recent authentication for sensitive actions (MOB-11 §47-§49).
 *
 * `ensure()` asks the server whether this session proved itself recently; if not
 * it raises a password prompt and resolves with the outcome. The server decides
 * what "recent" means and enforces it again on the action itself — this only
 * saves the person a failed request.
 */
export function useReauth(endpoint = "/api/me/security/reauthenticate") {
  const t = useTranslations("security");
  const [open, setOpen] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const settle = React.useRef<((ok: boolean) => void) | null>(null);

  const finish = React.useCallback((ok: boolean) => {
    settle.current?.(ok);
    settle.current = null;
    setOpen(false);
    setPassword("");
    setError(null);
  }, []);

  const ensure = React.useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin" });
      if (response.ok && ((await response.json()) as { data: { recent: boolean } }).data.recent) return true;
    } catch {
      // Could not ask: prompt, which is the safe direction.
    }
    return new Promise<boolean>((resolve) => {
      settle.current = resolve;
      setOpen(true);
    });
  }, [endpoint]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (response.ok) return finish(true);
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message === "RATE_LIMITED" || response.status === 409 ? t("reauth.tooMany") : response.status === 422 ? t("reauth.wrong") : t("reauth.failed"));
    } catch {
      setError(t("reauth.failed"));
    } finally {
      setPending(false);
    }
  }

  const dialog = (
    <Dialog open={open} onOpenChange={(next) => !next && finish(false)}>
      <DialogContent className="max-w-sm" presentation="sheet-phone">
        <form onSubmit={submit} className="space-y-4" data-testid="reauth-dialog">
          <DialogTitle>{t("reauth.title")}</DialogTitle>
          <DialogDescription>{t("reauth.body")}</DialogDescription>
          <div className="space-y-1.5">
            <Label htmlFor="reauth-password">{t("reauth.password")}</Label>
            <Input id="reauth-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} />
            {error ? <p role="alert" className="text-meta text-danger-strong">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => finish(false)} disabled={pending}>{t("devices.confirm.cancel")}</Button>
            <Button type="submit" disabled={pending || password.length === 0}>{t("reauth.confirm")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { ensure, dialog };
}
