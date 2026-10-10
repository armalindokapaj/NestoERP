"use client";

import * as React from "react";

import { useTranslations } from "@/components/i18n/i18n-provider";
import { engineeringApi, failureMessage, isFailure } from "@/components/engineering/engineering-api";
import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { CeoCandidate, CompanyLeadership } from "@/lib/modules/platform/company-leadership.service";
import { FormSelect } from "@/components/ui/form-select";

/** Where the company's leadership commands go: the platform console, or the group's own. */
export type LeadershipApi = { command: string };
export const PLATFORM_LEADERSHIP_API: LeadershipApi = { command: "/api/platform-admin/command" };
export const GROUP_LEADERSHIP_API: LeadershipApi = { command: "/api/group/command" };

type Flow = "assign" | "replace" | "remove";
type Created = { username: string; temporaryPassword?: string };

const field = "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-table text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
const send = <T,>(api: LeadershipApi, body: Record<string, unknown>) => engineeringApi<T>(api.command, { body });

/**
 * The company's CEO and the three things that can be done about it (Admin PRD
 * #12 §8, §38, §48, §77, §78): Assign, Change, Remove. The buttons follow what
 * the server said this actor may do; the server checks again on every command.
 */
export function CompanyLeadershipCard({ leadership, api = PLATFORM_LEADERSHIP_API }: { leadership: CompanyLeadership; api?: LeadershipApi }) {
  const t = useTranslations("adminOrgs");
  const [flow, setFlow] = React.useState<Flow | null>(null);
  const { ceo } = leadership;
  return (
    <section className="nesto-card p-5" aria-labelledby="company-leadership" data-testid="company-leadership">
      <h2 id="company-leadership" className="text-card font-semibold text-fg">{t("leadership.title")}</h2>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-meta text-fg-subtle">{t("leadership.ceo")}</p>
          {ceo ? (
            <>
              <p className="text-body font-medium text-fg" data-testid="company-ceo-name">{ceo.name}</p>
              {ceo.email ? <p className="font-mono text-micro text-fg-subtle">{ceo.email}</p> : null}
              <p className="text-table text-fg-muted" data-testid="company-ceo-state">{t(`leadership.state.${ceo.state}`)}</p>
              {ceo.state === "ACCOUNT_SUSPENDED" ? <p role="status" className="mt-1 text-table text-danger">{t("leadership.accountSuspendedWarning")}</p> : null}
              {ceo.state === "ACCESS_SUSPENDED" ? <p role="status" className="mt-1 text-table text-danger">{t("leadership.accessSuspendedWarning")}</p> : null}
              {ceo.viaGroup?.covers ? <p className="mt-1 text-meta text-fg-subtle">{t("leadership.viaGroup", { group: ceo.viaGroup.groupName })}</p> : null}
            </>
          ) : (
            <>
              <p className="text-body font-medium text-fg" data-testid="company-ceo-name">{t("leadership.notAssigned")}</p>
              {leadership.canManage ? <p className="text-table text-fg-muted">{t("leadership.emptyBody")}</p> : null}
            </>
          )}
        </div>
        {leadership.canManage ? (
          <div className="flex flex-wrap gap-2">
            {ceo ? (
              <>
                <Button size="sm" onClick={() => setFlow("replace")} data-testid="ceo-change">{t("leadership.change")}</Button>
                <Button size="sm" variant="secondary" onClick={() => setFlow("remove")} data-testid="ceo-remove">{t("leadership.remove")}</Button>
              </>
            ) : <Button size="sm" onClick={() => setFlow("assign")} data-testid="ceo-assign">{t("leadership.assign")}</Button>}
          </div>
        ) : null}
      </div>
      {flow ? <LeadershipDialog flow={flow} leadership={leadership} api={api} onClose={() => setFlow(null)} /> : null}
    </section>
  );
}

function LeadershipDialog({ flow, leadership, api, onClose }: { flow: Flow; leadership: CompanyLeadership; api: LeadershipApi; onClose: () => void }) {
  const t = useTranslations("adminOrgs");
  const router = useRouter();
  const toast = useToast();
  const { ceo, companyId, companyName } = leadership;
  const needsPerson = flow !== "remove";
  const [mode, setMode] = React.useState<"new" | "existing">("existing");
  const [form, setForm] = React.useState({ firstName: "", lastName: "", email: "" });
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<CeoCandidate[]>([]);
  const [chosen, setChosen] = React.useState<CeoCandidate | null>(null);
  const [confirmReactivate, setConfirmReactivate] = React.useState(false);
  const [keep, setKeep] = React.useState<"KEEP_WITH_ROLE" | "REMOVE">("KEEP_WITH_ROLE");
  const [roleKey, setRoleKey] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [stale, setStale] = React.useState(false);
  const [offer, setOffer] = React.useState<{ userId: string } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const dirty = Boolean(form.firstName || form.lastName || form.email || chosen);

  React.useEffect(() => {
    if (!needsPerson || mode !== "existing" || chosen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      engineeringApi<CeoCandidate[]>(api.command, { body: { action: "company.ceo.candidates", companyId, q: query }, signal: controller.signal })
        .then(setResults, (failure: unknown) => { if (!controller.signal.aborted) setError(failureMessage(failure)); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [needsPerson, mode, chosen, query, api.command, companyId]);

  function close() {
    if (pending) return;
    if (dirty && !created && !window.confirm(t("leadership.discard"))) return;
    onClose();
  }

  async function choose(candidate: CeoCandidate) {
    setError(null);
    setConfirmReactivate(false);
    try {
      setChosen(await send<CeoCandidate>(api, { action: "company.ceo.candidate", companyId, userId: candidate.userId }));
    } catch (failure) {
      setError(failureMessage(failure));
    }
  }

  const blocked = chosen?.blocked ?? null;
  const previousName = ceo?.name ?? "";
  const previous = keep === "REMOVE" ? { action: "REMOVE" } : { action: "KEEP_WITH_ROLE", roleKey };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setOffer(null);
    if (needsPerson && mode === "existing" && !chosen) return setError(t("leadership.noResults"));
    if (needsPerson && blocked) return;
    if (flow !== "assign" && keep === "KEEP_WITH_ROLE" && !roleKey) return setError(t("leadership.chooseRoleFirst"));
    const person = mode === "new" ? { mode, firstName: form.firstName, lastName: form.lastName, email: form.email } : { mode, userId: chosen?.userId };
    const body = flow === "assign"
      ? { action: "company.ceo.assign", companyId, confirmReactivate, ...person }
      : flow === "replace"
        ? { action: "company.ceo.replace", companyId, expectedCurrentCeoUserId: ceo?.userId, previous, confirmReactivate, ...person }
        : { action: "company.ceo.remove", companyId, expectedCurrentCeoUserId: ceo?.userId, previous };
    setPending(true);
    try {
      const result = await send<{ userId: string; username: string; temporaryPassword?: string } | { ok: true }>(api, body);
      toast({ title: flow === "assign" ? t("leadership.assigned", { name: mode === "new" ? `${form.firstName} ${form.lastName}` : chosen?.name ?? "", company: companyName }) : flow === "replace" ? t("leadership.replaced") : t("leadership.removed", { name: previousName }), tone: "success" });
      router.refresh();
      if ("temporaryPassword" in result && result.temporaryPassword) setCreated({ username: result.username, temporaryPassword: result.temporaryPassword });
      else onClose();
    } catch (failure) {
      const details = isFailure(failure) && failure.details && typeof failure.details === "object" ? (failure.details as { code?: string; userId?: string }) : null;
      if (details?.code === "ACCOUNT_EXISTS" && details.userId) setOffer({ userId: details.userId });
      if (details?.code === "LEADERSHIP_CHANGED" || details?.code === "CEO_EXISTS") setStale(true);
      // Nothing was applied: leadership changes are one transaction.
      setError(failureMessage(failure, t("leadership.failed")));
    } finally {
      setPending(false);
    }
  }

  const title = flow === "assign" ? t("leadership.assignTitle") : flow === "replace" ? t("leadership.changeTitle") : t("leadership.removeTitle", { name: previousName });
  const submitLabel = flow === "assign" ? (mode === "new" ? t("leadership.createSubmit") : t("leadership.assignSubmit")) : flow === "replace" ? t("leadership.replaceSubmit") : t("leadership.removeSubmit");

  if (created) {
    return (
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-md">
          <DialogTitle>{t("leadership.createdTitle")}</DialogTitle>
          <DialogDescription>{t("leadership.createdBody")}</DialogDescription>
          <dl className="mt-4 space-y-3">
            <div><dt className="text-meta text-fg-subtle">{t("leadership.username")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.username}<CopyButton value={created.username} label={t("leadership.username")} /></dd></div>
            <div><dt className="text-meta text-fg-subtle">{t("leadership.temporaryPassword")}</dt><dd className="flex items-center gap-2 font-mono text-body">{created.temporaryPassword}<CopyButton value={created.temporaryPassword ?? ""} label={t("leadership.temporaryPassword")} /></dd></div>
          </dl>
          <DialogFooter><Button onClick={onClose}>{t("leadership.done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open locked={pending} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto" data-testid="ceo-dialog">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t("leadership.company", { name: companyName })}</DialogDescription>
        <form onSubmit={submit} className="mt-4 space-y-4">
          {flow === "replace" && ceo ? <p className="text-table text-fg-muted">{t("leadership.currentCeo")}: <span className="font-medium text-fg">{ceo.name}</span></p> : null}
          {needsPerson ? (
            <>
              <div role="radiogroup" className="flex flex-wrap gap-4 text-table">
                <label className="flex items-center gap-2"><input type="radio" name="ceo-mode" checked={mode === "new"} onChange={() => { setMode("new"); setChosen(null); }} />{t("leadership.createNew")}</label>
                <label className="flex items-center gap-2"><input type="radio" name="ceo-mode" checked={mode === "existing"} onChange={() => setMode("existing")} />{t("leadership.selectExisting")}</label>
              </div>
              {mode === "new" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1 text-meta text-fg-subtle">{t("leadership.firstName")}<input className={field} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} required maxLength={80} /></label>
                  <label className="block space-y-1 text-meta text-fg-subtle">{t("leadership.lastName")}<input className={field} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} required maxLength={80} /></label>
                  <label className="block space-y-1 text-meta text-fg-subtle sm:col-span-2">{t("leadership.email")}<input type="email" className={field} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required maxLength={200} /></label>
                </div>
              ) : chosen ? (
                <div className="space-y-2 rounded-lg border border-line p-3 text-table" data-testid="ceo-preview">
                  <div className="flex items-center justify-between gap-2">
                    <span><span className="font-medium text-fg">{chosen.name}</span>{chosen.email ? <span className="block text-meta text-fg-subtle">{chosen.email}</span> : null}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setChosen(null); setConfirmReactivate(false); }}>{t("leadership.change_")}</Button>
                  </div>
                  <div>
                    <p className="text-meta text-fg-subtle">{t("leadership.existingAccess")}</p>
                    {chosen.group || chosen.company ? (
                      <ul className="text-fg">
                        {chosen.group ? <li>{t("leadership.groupAccessLine", { group: chosen.group.name, role: chosen.group.roleKey ?? "—" })}</li> : null}
                        {chosen.company ? <li>{companyName} — {chosen.company.roleKey}</li> : null}
                      </ul>
                    ) : <p className="text-fg-muted">{t("leadership.noOtherAccess")}</p>}
                  </div>
                  <div><p className="text-meta text-fg-subtle">{t("leadership.newAccess")}</p><p className="text-fg">{t("leadership.willAdd", { company: companyName })}</p></div>
                  {chosen.company && !chosen.blocked && !chosen.reactivates ? <p className="text-meta text-fg-muted">{t("leadership.willBecome", { company: companyName, role: chosen.company.roleKey })}</p> : null}
                  {chosen.reactivates && chosen.company && !chosen.blocked ? (
                    <label className="flex items-start gap-2 text-fg"><input type="checkbox" className="mt-1" checked={confirmReactivate} onChange={(event) => setConfirmReactivate(event.target.checked)} /><span>{t("leadership.reactivates", { company: companyName, status: chosen.company.status.toLowerCase() })} <span className="font-medium">{t("leadership.confirmReactivate")}</span></span></label>
                  ) : null}
                  {blocked ? <p role="alert" className="text-danger">{blocked === "ACCOUNT_SUSPENDED" ? t("leadership.blockedAccount", { name: chosen.name }) : blocked === "GROUP_COVERED" ? t("leadership.blockedGroup", { name: chosen.name }) : t("leadership.blockedPlatform")}</p> : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <input className={field} placeholder={t("leadership.search")} aria-label={t("leadership.searchAria")} value={query} onChange={(event) => setQuery(event.target.value)} />
                  <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label={t("leadership.searchAria")}>
                    {results.length === 0 ? <li className="p-2.5 text-meta text-fg-subtle">{t("leadership.noResults")}</li> : results.map((row) => (
                      <li key={row.userId}>
                        <button type="button" className="w-full px-2.5 py-2 text-left text-table hover:bg-hover" onClick={() => void choose(row)} data-testid="ceo-candidate">
                          <span className="font-medium text-fg">{row.name}</span>
                          <span className="block text-meta text-fg-subtle">{row.email}{row.group ? ` · ${row.group.roleKey ?? ""} ${row.group.name}`.replace("  ", " ") : ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : null}
          {flow !== "assign" && ceo ? (
            <fieldset className="space-y-2 rounded-lg border border-line p-3 text-table">
              <legend className="px-1 text-meta text-fg-subtle">{t("leadership.previousAccessTitle", { name: ceo.name })}</legend>
              <label className="flex items-center gap-2"><input type="radio" name="previous" checked={keep === "KEEP_WITH_ROLE"} onChange={() => setKeep("KEEP_WITH_ROLE")} />{t("leadership.keepAccess")}</label>
              {keep === "KEEP_WITH_ROLE" ? (
                <label className="ml-6 block space-y-1 text-meta text-fg-subtle">{t("leadership.keepRole")}
                  <FormSelect className={field} value={roleKey} onChange={(event) => setRoleKey(event.target.value)} required data-testid="ceo-previous-role">
                    <option value="">{t("leadership.chooseRole")}</option>
                    {leadership.fallbackRoles.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
                  </FormSelect>
                </label>
              ) : null}
              <label className="flex items-center gap-2"><input type="radio" name="previous" checked={keep === "REMOVE"} onChange={() => setKeep("REMOVE")} />{t("leadership.removeAccess")}</label>
              <p className="text-meta text-fg-muted">
                {flow === "replace" ? t("leadership.previewReplace", { old: ceo.name, new: chosen?.name ?? (mode === "new" ? `${form.firstName} ${form.lastName}`.trim() || "…" : "…") }) : t("leadership.previewRemove", { name: ceo.name })}
              </p>
              {ceo.viaGroup?.covers ? <p className="text-meta text-fg-muted">{t("leadership.stillViaGroup", { name: ceo.name, group: ceo.viaGroup.groupName })}</p> : null}
            </fieldset>
          ) : null}
          {error ? <p role="alert" className="text-table text-danger">{error}</p> : null}
          {offer ? <Button type="button" size="sm" variant="secondary" onClick={() => { setMode("existing"); setOffer(null); setError(null); void choose({ userId: offer.userId } as CeoCandidate); }}>{t("leadership.accountExists")}</Button> : null}
          {stale ? <Button type="button" size="sm" variant="secondary" onClick={() => { router.refresh(); onClose(); }}>{t("leadership.refresh")}</Button> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>{t("leadership.cancel")}</Button>
            <Button type="submit" variant={flow === "remove" ? "danger" : "primary"} disabled={pending || stale || (needsPerson && Boolean(blocked)) || (needsPerson && Boolean(chosen?.reactivates) && !confirmReactivate)} data-testid="ceo-submit">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
