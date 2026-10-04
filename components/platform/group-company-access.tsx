"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage, isFailure } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

export type CompanyAccessValue = { mode: "NONE" | "ALL" | "SELECTED"; companyIds: string[] };
export const NO_COMPANY_ACCESS: CompanyAccessValue = { mode: "NONE", companyIds: [] };

type Choice = { id: string; name: string; status: string; country: string | null };
type Choices = { total: number; companies: Choice[]; nextCursor: string | null };
type Api = { command: string };

const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * None / All / Selected company access with a searchable, server-paged picker
 * of this group's companies (PRD #10 §11-§18, §60-§61, §100-§104). The choice
 * is held as given: ticking every company is still Selected, never All.
 */
export function CompanyAccessPicker({ groupId, groupName, api, value, onChange, error, disabled = false, idPrefix }: { groupId: string; groupName: string; api: Api; value: CompanyAccessValue; onChange: (next: CompanyAccessValue) => void; error?: string | null; disabled?: boolean; idPrefix: string }) {
  const t = useTranslations("adminOrgs");
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<Choice[]>([]);
  const [total, setTotal] = React.useState<number | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const selecting = value.mode === "SELECTED";

  const load = React.useCallback(async (after: string | null, signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const page = await engineeringApi<Choices>(api.command, { body: { action: "group.access.companies", groupId, q: query, ...(after ? { cursor: after } : {}) }, signal });
      setRows((current) => (after ? [...current, ...page.companies] : page.companies));
      setTotal(page.total);
      setCursor(page.nextCursor);
    } catch {
      if (!signal?.aborted) setLoadError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [api.command, groupId, query]);

  React.useEffect(() => {
    if (!selecting) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(null, controller.signal), query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [selecting, load, query, attempt]);

  const chosen = new Set(value.companyIds);
  const allShown = rows.length > 0 && rows.every((row) => chosen.has(row.id));
  function toggle(companyId: string) {
    const next = new Set(chosen);
    if (next.has(companyId)) next.delete(companyId); else next.add(companyId);
    onChange({ mode: "SELECTED", companyIds: [...next] });
  }
  function toggleShown() {
    const next = new Set(chosen);
    for (const row of rows) { if (allShown) next.delete(row.id); else next.add(row.id); }
    onChange({ mode: "SELECTED", companyIds: [...next] });
  }
  const errorId = `${idPrefix}-access-error`;

  return (
    <fieldset className="space-y-2" disabled={disabled} aria-describedby={error ? errorId : undefined} data-testid="company-access">
      <legend className="text-meta text-fg-subtle">{t("groupUsers.accessLabel")}</legend>
      <label className="flex items-start gap-2 text-table text-fg">
        <input type="radio" className="mt-1" name={`${idPrefix}-access`} checked={value.mode === "NONE"} onChange={() => onChange({ mode: "NONE", companyIds: [] })} />
        <span>{t("groupUsers.accessNone")}<span className="block text-meta text-fg-muted">{t("groupUsers.accessNoneHint")}</span></span>
      </label>
      <label className="flex items-start gap-2 text-table text-fg">
        <input type="radio" className="mt-1" name={`${idPrefix}-access`} checked={value.mode === "ALL"} onChange={() => onChange({ mode: "ALL", companyIds: [] })} />
        <span>{t("groupUsers.accessAll")}<span className="block text-meta text-fg-muted">{t("groupUsers.accessAllHint", { group: groupName })}</span></span>
      </label>
      <label className="flex items-start gap-2 text-table text-fg">
        <input type="radio" className="mt-1" name={`${idPrefix}-access`} checked={selecting} onChange={() => onChange({ mode: "SELECTED", companyIds: value.companyIds })} />
        <span>{t("groupUsers.accessSelected")}<span className="block text-meta text-fg-muted">{t("groupUsers.accessSelectedHint")}</span></span>
      </label>
      {selecting ? (
        <div className="space-y-2 rounded-lg border border-line p-2.5" data-testid="company-picker">
          {total === 0 && !query && !loading && !loadError ? (
            <p className="text-meta text-fg-subtle">{t("groupUsers.accessEmptyGroup")}</p>
          ) : (
            <>
              <input className={field} placeholder={t("groupUsers.accessSearch")} aria-label={t("groupUsers.accessSearch")} value={query} onChange={(event) => setQuery(event.target.value)} />
              <div className="flex items-center justify-between gap-2 text-meta text-fg-muted">
                <label className="flex items-center gap-2"><input type="checkbox" checked={allShown} onChange={toggleShown} disabled={rows.length === 0} />{t("groupUsers.accessSelectAll")}</label>
                <span aria-live="polite">{t("groupUsers.accessCount", { count: value.companyIds.length })}</span>
              </div>
              {loadError ? (
                <div role="alert" className="flex items-center justify-between gap-2 text-table text-danger">
                  <span>{t("groupUsers.accessLoadFailed")}</span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setAttempt((count) => count + 1)}>{t("groupUsers.accessRetry")}</Button>
                </div>
              ) : (
                <ul className="max-h-48 divide-y divide-line overflow-y-auto" aria-busy={loading}>
                  {rows.map((row) => (
                    <li key={row.id}>
                      <label className="flex items-center gap-2 px-1 py-1.5 text-table text-fg">
                        <input type="checkbox" checked={chosen.has(row.id)} onChange={() => toggle(row.id)} />
                        <span>{row.name}<span className="ml-2 text-meta text-fg-subtle">{[row.status === "ACTIVE" ? null : row.status, row.country].filter(Boolean).join(" · ")}</span></span>
                      </label>
                    </li>
                  ))}
                  {loading && rows.length === 0 ? <li className="h-8 animate-pulse rounded bg-hover" aria-hidden="true" /> : null}
                </ul>
              )}
              {cursor && !loadError ? <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => void load(cursor)}>{t("groupUsers.accessLoadMore")}</Button> : null}
            </>
          )}
        </div>
      ) : null}
      {error ? <p id={errorId} role="alert" className="text-table text-danger">{error}</p> : null}
    </fieldset>
  );
}

/**
 * Edit Access (PRD #10 §35-§40, §61-§64, §103-§106): loads the canonical policy
 * before it can be saved, confirms once on Save when the reach materially widens
 * or narrows, and keeps the form on failure so it can be retried.
 */
export function EditCompanyAccessDialog({ open, onOpenChange, groupId, groupName, api, person }: { open: boolean; onOpenChange: (open: boolean) => void; groupId: string; groupName: string; api: Api; person: { userId: string; name: string } }) {
  const t = useTranslations("adminOrgs");
  const router = useRouter();
  const toast = useToast();
  const [loaded, setLoaded] = React.useState<{ value: CompanyAccessValue; version: number } | null>(null);
  const [value, setValue] = React.useState<CompanyAccessValue>(NO_COMPANY_ACCESS);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [confirm, setConfirm] = React.useState<"broaden" | "reduce" | "discard" | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoaded(null); setError(null); setConfirm(null);
    engineeringApi<{ mode: CompanyAccessValue["mode"]; companyIds: string[]; version: number }>(api.command, { body: { action: "group.access.get", groupId, userId: person.userId }, signal: controller.signal })
      .then((state) => { setLoaded({ value: { mode: state.mode, companyIds: state.companyIds }, version: state.version }); setValue({ mode: state.mode, companyIds: state.companyIds }); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failureMessage(failure, t("groupUsers.accessLoadFailed"))); });
    return () => controller.abort();
  }, [open, api.command, groupId, person.userId, attempt, t]);

  const dirty = loaded !== null && (loaded.value.mode !== value.mode || [...loaded.value.companyIds].sort().join() !== [...value.companyIds].sort().join());
  const needsOne = value.mode === "SELECTED" && value.companyIds.length === 0;

  function intent(): "broaden" | "reduce" | null {
    if (!loaded) return null;
    const was = loaded.value;
    if (value.mode === "ALL" && was.mode !== "ALL") return "broaden";
    if ((was.mode === "ALL" && value.mode !== "ALL") || (was.mode === "SELECTED" && was.companyIds.some((companyId) => !value.companyIds.includes(companyId)))) return "reduce";
    return null;
  }

  async function save() {
    if (!loaded || pending) return;
    setPending(true);
    setError(null);
    try {
      await engineeringApi(api.command, { body: { action: "group.access.update", groupId, userId: person.userId, companyAccess: value, expectedVersion: loaded.version } });
      toast({ title: t("groupUsers.accessSaved"), tone: "success" });
      setConfirm(null);
      onOpenChange(false);
      router.refresh();
    } catch (failure) {
      const conflict = isFailure(failure) && failure.details && typeof failure.details === "object" && (failure.details as { code?: string }).code === "ACCESS_CHANGED";
      setConfirm(null);
      setError(conflict ? t("groupUsers.accessConflict") : `${failureMessage(failure, t("groupUsers.accessSaveFailed"))}`);
      if (conflict) setAttempt((count) => count + 1);
    } finally {
      setPending(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (needsOne) return setError(t("groupUsers.accessNeedOne"));
    const ask = intent();
    if (ask) return setConfirm(ask);
    void save();
  }

  function close(next: boolean) {
    if (next) return onOpenChange(true);
    if (dirty && confirm !== "discard") return setConfirm("discard");
    setConfirm(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} locked={pending} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto" data-testid="edit-access-dialog">
        <DialogTitle>{t("groupUsers.accessTitle", { name: person.name })}</DialogTitle>
        <DialogDescription>{groupName}</DialogDescription>
        {confirm && confirm !== "discard" ? (
          <div className="mt-4 space-y-2" role="alertdialog" aria-label={confirm === "broaden" ? t("groupUsers.accessBroadenTitle") : t("groupUsers.accessReduceTitle")}>
            <p className="font-medium text-fg">{confirm === "broaden" ? t("groupUsers.accessBroadenTitle") : t("groupUsers.accessReduceTitle")}</p>
            <p className="text-table text-fg-muted">{confirm === "broaden" ? t("groupUsers.accessBroadenBody", { name: person.name, group: groupName }) : t("groupUsers.accessReduceBody", { name: person.name, group: groupName })}</p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setConfirm(null)} disabled={pending}>{t("users.member.cancel")}</Button>
              <Button type="button" variant={confirm === "reduce" ? "danger" : "primary"} onClick={() => void save()} disabled={pending}>{t("groupUsers.accessConfirm")}</Button>
            </DialogFooter>
          </div>
        ) : confirm === "discard" ? (
          <div className="mt-4 space-y-2" role="alertdialog" aria-label={t("groupUsers.accessDiscard")}>
            <p className="text-table text-fg">{t("groupUsers.accessDiscard")}</p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>{t("users.member.cancel")}</Button>
              <Button type="button" variant="danger" onClick={() => { setConfirm(null); onOpenChange(false); }}>{t("groupUsers.accessConfirm")}</Button>
            </DialogFooter>
          </div>
        ) : !loaded ? (
          error ? (
            <div role="alert" className="mt-4 flex items-center justify-between gap-2 text-table text-danger"><span>{error}</span><Button type="button" size="sm" variant="secondary" onClick={() => setAttempt((count) => count + 1)}>{t("groupUsers.accessRetry")}</Button></div>
          ) : (
            <div className="mt-4 space-y-2" aria-busy="true"><div className="h-6 animate-pulse rounded bg-hover" /><div className="h-6 animate-pulse rounded bg-hover" /><div className="h-6 animate-pulse rounded bg-hover" /></div>
          )
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <CompanyAccessPicker groupId={groupId} groupName={groupName} api={api} value={value} onChange={(next) => { setError(null); setValue(next); }} error={error} idPrefix={`edit-${person.userId}`} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)} disabled={pending}>{t("users.member.cancel")}</Button>
              <Button type="submit" disabled={pending || !dirty}>{t("groupUsers.accessSave")}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
