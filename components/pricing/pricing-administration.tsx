"use client";

import * as React from "react";
import { useRouter } from "@/components/navigation/guarded-router";
import { useTranslations } from "@/components/i18n/i18n-provider";
import { CheckCircle2, CirclePlus, Save, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogEditor } from "@/components/sales/unit-sales/unit-sales-dialogs";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SaveMessages, UnsavedIndicator } from "@/components/unsaved/editor-status";
import { useEditorSave } from "@/components/unsaved/use-editor-save";
import { useUnsavedEditor } from "@/components/unsaved/use-unsaved";
import type { getPricingAdministration } from "@/lib/modules/pricing/pricing.service";
import type { Foundation, PricingConfig, PricingModule, PricingPromotionConfig, RozarisClass } from "@/lib/modules/pricing/pricing.types";
import type { SaveOutcome } from "@/lib/unsaved/coordinator";
import { outcomeOf } from "@/lib/unsaved/outcome";

type PricingAdminData = Awaited<ReturnType<typeof getPricingAdministration>>;
type Version = PricingAdminData["versions"][number];
type Promotion = PricingAdminData["promotions"][number];

/** The server answered, and refused: nothing was saved (AUD-03 §6). */
class PricingRefusal extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/**
 * One request to the pricing API. A refusal throws `PricingRefusal`; a request
 * that never got an answer throws anything else — it may have gone through.
 */
async function adminRequest<T>(url: string, method: "POST" | "PATCH", body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string; code?: string; details?: { code?: string } } } | null;
  if (!response.ok || !payload?.data) throw new PricingRefusal(payload?.error?.message ?? fallback, payload?.error?.details?.code ?? payload?.error?.code);
  return payload.data;
}

/** What a pricing request's failure means for the unsaved-work contract (AUD-03 §6). */
function failureOutcome(failure: unknown): SaveOutcome {
  return failure instanceof PricingRefusal ? outcomeOf({ ok: false, code: failure.code, error: failure.message }) : { kind: "unknown" };
}

/**
 * A controlled pricing editor's place in the unsaved-work contract (AUD-03 §3):
 * dirty while its values differ from the last ones the server accepted, and a
 * "Save and continue" that runs its own Save.
 */
function usePricingEditor(label: string, values: unknown, save: () => Promise<SaveOutcome>) {
  const key = JSON.stringify(values);
  const [baseline, setBaseline] = React.useState(key);
  const editor = useUnsavedEditor({ module: "pricing", saveKind: "save", label, save });
  const { setDirty } = editor;
  React.useEffect(() => setDirty(key !== baseline), [key, baseline, setDirty]);
  /** Only after the server said yes: the values it accepted become the baseline. */
  const accept = React.useCallback((saved: string) => setBaseline(saved), []);
  return { editor, key, accept };
}

export function PricingAdministration({ data }: { data: PricingAdminData }) {
  const t = useTranslations("adminOrgs");
  const active = data.versions.find((version) => version.status === "ACTIVE");
  const drafts = data.versions.filter((version) => version.status === "DRAFT");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-card font-semibold text-fg">{t("pricing.activeBook")}</h2>
                {active ? <Badge tone="success">{active.versionCode}</Badge> : <Badge tone="danger">{t("pricing.unavailable")}</Badge>}
              </div>
              <p className="mt-1 text-table text-fg-muted">{t("pricing.activeBookNote")}</p>
            </div>
            <CreateDraft />
          </div>
          {active ? <PriceBookSummary config={active.configJson} /> : null}
        </Card>

        <Card className="p-5">
          <h2 className="text-card font-semibold text-fg">{t("pricing.currentPromotion")}</h2>
          <p className="mt-1 text-table text-fg-muted">{t("pricing.promotionsNote")}</p>
          {data.promotions.map((promotion) => <PromotionEditor key={promotion.id} promotion={promotion} />)}
        </Card>
      </div>

      {drafts.map((draft) => <PricingVersionEditor key={draft.id} version={draft} />)}
      <VersionHistory versions={data.versions} />
      <RecentQuotes quotes={data.recentQuotes} />
    </div>
  );
}

function PriceBookSummary({ config }: { config: PricingConfig }) {
  const t = useTranslations("adminOrgs");
  const eur = (cents: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
  const mo = (cents: number) => t("pricing.perMonth", { amount: eur(cents) });
  const platform = config.foundations.find((row) => row.id === "NESTO_PLATFORM");
  const priced = config.modules.filter((row) => row.enabled && row.public && row.monthlyPriceCents > 0).length;
  return (
    <dl className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
      <Summary label={t("pricing.sumPlatformBase")} value={platform ? mo(platform.baseMonthlyCents) : "—"} />
      <Summary label={t("pricing.sumPricedModules")} value={t("pricing.ofTotal", { priced, total: config.modules.filter((row) => row.public).length })} />
      <Summary label={t("pricing.sumProjectAddon")} value={mo(config.nestoProjects.additionalMonthlyCents)} />
      <Summary label={t("pricing.sumRozarisClasses")} value={(["BASIC", "LARGE", "VILLAGE"] as const).map((key) => eur(config.rozaris.classes[key].monthly24Cents)).join(" · ")} />
      <Summary label={t("pricing.sumRozarisUsers")} value={`${(["BASIC", "LARGE", "VILLAGE"] as const).map((key) => config.rozaris.classes[key].includedUsers).join(" / ")} · ${t(`pricing.allowanceShort.${config.rozaris.userAllowanceMode}`)}`} />
      <Summary label={t("pricing.sumUserPacks")} value={config.users.map((rule) => t("pricing.packLabel", { foundation: rule.foundation === "ROZARIS" ? "ROZARIS" : t("pricing.platformShort"), size: rule.packSize, price: eur(rule.pricePerPackCents) })).join(" · ")} />
    </dl>
  );
}

function CreateDraft() {
  const t = useTranslations("adminOrgs");
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}><CirclePlus /> {t("pricing.newVersion")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t("pricing.createTitle")}</DialogTitle>
          <DialogDescription>{t("pricing.createDescription")}</DialogDescription>
          <CreateDraftForm onCreated={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Registered inside the dialog, so its X, Escape and Cancel ask about a typed code (AUD-03 §5). */
function CreateDraftForm({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations("adminOrgs");
  const router = useRouter();
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const save = useEditorSave({
    formRef,
    module: "pricing",
    saveKind: "create",
    label: t("pricing.newVersionLabel"),
    action: async (formData: FormData) => {
      try {
        await adminRequest("/api/platform/pricing/versions", "POST", { versionCode: String(formData.get("versionCode") ?? "") }, t("pricing.refusalFallback"));
        return { ok: true as const };
      } catch (failure) {
        // A request that never got an answer stays thrown: its outcome is unknown.
        if (!(failure instanceof PricingRefusal)) throw failure;
        return { ok: false as const, code: failure.code, error: failure.message };
      }
    },
    onCommitted: () => {
      toast({ title: t("pricing.draftCreated"), tone: "success" });
      onCreated();
      router.refresh();
      return true;
    },
  });

  return (
    <form ref={formRef} onSubmit={save.onSubmit} className="mt-5">
      <fieldset disabled={save.pending || Boolean(save.saved)} className="m-0 min-w-0 border-0 p-0">
        <Field label={t("pricing.versionCode")}>
          <Input name="versionCode" required pattern="\d{4}\.\d{2}(\.\d+)?" placeholder="2027.01" defaultValue="" />
        </Field>
      </fieldset>
      <SaveMessages save={save} className="mt-3" />
      <DialogFooter>
        <UnsavedIndicator save={save} />
        <DialogClose asChild>
          <Button type="button" variant="secondary">{t("pricing.cancel")}</Button>
        </DialogClose>
        <Button type="submit" disabled={save.pending}>{save.pending ? t("pricing.creating") : t("pricing.createDraft")}</Button>
      </DialogFooter>
    </form>
  );
}

function PricingVersionEditor({ version }: { version: Version }) {
  const t = useTranslations("adminOrgs");
  const [config, setConfig] = React.useState<PricingConfig>(version.configJson);
  const [effectiveFrom, setEffectiveFrom] = React.useState(version.effectiveFrom.slice(0, 10));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const router = useRouter();
  const toast = useToast();

  const update = (patch: (current: PricingConfig) => PricingConfig) => setConfig(patch);
  const setFoundation = (id: Foundation, patch: Partial<PricingConfig["foundations"][number]>) => update((current) => ({ ...current, foundations: current.foundations.map((row) => row.id === id ? { ...row, ...patch } : row) }));
  const setModule = (id: string, patch: Partial<PricingModule>) => update((current) => ({ ...current, modules: current.modules.map((row) => row.id === id ? { ...row, ...patch } : row) }));
  const setCompanies = (id: Foundation, patch: Partial<PricingConfig["companies"][Foundation]>) => update((current) => ({ ...current, companies: { ...current.companies, [id]: { ...current.companies[id], ...patch } } }));
  const setUsers = (id: Foundation, patch: Partial<PricingConfig["users"][number]>) => update((current) => ({ ...current, users: current.users.map((row) => row.foundation === id ? { ...row, ...patch } : row) }));
  const setClass = (id: RozarisClass, patch: Partial<PricingConfig["rozaris"]["classes"][RozarisClass]>) => update((current) => ({ ...current, rozaris: { ...current.rozaris, classes: { ...current.rozaris.classes, [id]: { ...current.rozaris.classes[id], ...patch } } } }));
  const ids = (value: string) => value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);

  const draft = usePricingEditor(t("pricing.draftLabel", { code: version.versionCode }), [config, effectiveFrom], () => save());

  /** The draft's one save path: its Save button and "Save and continue" alike (AUD-03 §3). */
  async function save(): Promise<SaveOutcome> {
    const submitted = draft.key;
    setPending(true);
    draft.editor.setSaving(true);
    draft.editor.setUnresolved(false);
    setError(null);
    try {
      await adminRequest(`/api/platform/pricing/versions/${version.id}`, "PATCH", {
        config,
        effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`).toISOString(),
      }, t("pricing.refusalFallback"));
      draft.accept(submitted);
      toast({ title: t("pricing.draftSaved"), tone: "success" });
      router.refresh();
      return { kind: "committed" };
    } catch (failure) {
      const outcome = failureOutcome(failure);
      draft.editor.setUnresolved(outcome.kind === "unknown");
      setError(failure instanceof Error ? failure.message : t("pricing.draftSaveFailed"));
      return outcome;
    } finally {
      setPending(false);
      draft.editor.setSaving(false);
    }
  }

  async function publishVersion() {
    setPending(true);
    setError(null);
    try {
      await adminRequest(`/api/platform/pricing/versions/${version.id}/publish`, "POST", { confirmed: true, reason }, t("pricing.refusalFallback"));
      toast({ title: t("pricing.nowActive", { code: version.versionCode }), tone: "success" });
      setPublishOpen(false);
      setReason("");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("pricing.publishFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><h2 className="text-card font-semibold text-fg">{t("pricing.draftLabel", { code: version.versionCode })}</h2><Badge tone="warning">{t("pricing.draftBadge")}</Badge></div>
          <p className="mt-1 text-table text-fg-muted">{t("pricing.draftNote")}</p>
        </div>
        {/* Wraps inside the card at 320-360px when the unsaved indicator shows (AUD-04 §3, D-09-21, MW-01). */}
        <div className="flex flex-wrap gap-2">
          <UnsavedIndicator save={{ editor: draft.editor, pending, saved: null }} className="self-center" />
          <Button type="button" variant="secondary" onClick={() => void save()} disabled={pending}><Save /> {t("pricing.saveDraft")}</Button>
          <Button type="button" onClick={() => setPublishOpen(true)} disabled={pending}><Send /> {t("pricing.publish")}</Button>
        </div>
      </div>

      <div className="mt-5 space-y-6 border-t border-line pt-5">
        <div className="grid gap-6 xl:grid-cols-2">
          {config.foundations.map((foundation) => (
            <EditorGroup key={foundation.id} title={t("pricing.foundationTitle", { name: foundation.id === "ROZARIS" ? "ROZARIS" : t("pricing.foundationPlatform") })}>
              <label className="flex items-center gap-3 text-table text-fg"><input type="checkbox" checked={foundation.enabled} onChange={(event) => setFoundation(foundation.id, { enabled: event.target.checked })} /> {t("pricing.offeredPublicly")}</label>
              <Field label={t("pricing.publicName")}><Input value={foundation.name} onChange={(event) => setFoundation(foundation.id, { name: event.target.value })} /></Field>
              <MoneyField label={t("pricing.baseMonth")} cents={foundation.baseMonthlyCents} set={(value) => setFoundation(foundation.id, { baseMonthlyCents: value })} />
              <Field label={t("pricing.publicDescription")}><Textarea value={foundation.description} onChange={(event) => setFoundation(foundation.id, { description: event.target.value })} /></Field>
              <Field label={t("pricing.includedLines")}><Textarea value={foundation.included.join("\n")} onChange={(event) => setFoundation(foundation.id, { included: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} /></Field>
              <NumberField label={t("pricing.includedCompanies")} value={config.companies[foundation.id].included} set={(value) => setCompanies(foundation.id, { included: Math.max(1, value) })} />
              <label className="flex items-center gap-3 text-table text-fg"><input type="checkbox" checked={config.companies[foundation.id].additionalAvailable} onChange={(event) => setCompanies(foundation.id, { additionalAvailable: event.target.checked })} /> {t("pricing.additionalCompaniesPublic")}</label>
              <MoneyField label={t("pricing.groupCompanyMonth")} cents={config.companies[foundation.id].fullGroupMonthlyCents} set={(value) => setCompanies(foundation.id, { fullGroupMonthlyCents: value })} />
              <MoneyField label={t("pricing.jvCompanyMonth")} cents={config.companies[foundation.id].jointVentureMonthlyCents} set={(value) => setCompanies(foundation.id, { jointVentureMonthlyCents: value })} />
              <MoneyField label={t("pricing.documentsOnlyMonth")} cents={config.companies[foundation.id].documentsOnlyMonthlyCents} set={(value) => setCompanies(foundation.id, { documentsOnlyMonthlyCents: value })} />
              <NumberField label={t("pricing.usersPerFullCompany")} value={config.companies[foundation.id].includedUsersPerFullCompany} set={(value) => setCompanies(foundation.id, { includedUsersPerFullCompany: value })} />
              <NumberField label={t("pricing.userPackSize")} value={config.users.find((row) => row.foundation === foundation.id)?.packSize ?? 1} set={(value) => setUsers(foundation.id, { packSize: Math.max(1, value) })} />
              <MoneyField label={t("pricing.userPackMonth")} cents={config.users.find((row) => row.foundation === foundation.id)?.pricePerPackCents ?? 0} set={(value) => setUsers(foundation.id, { pricePerPackCents: value })} />
              {foundation.id === "NESTO_PLATFORM" ? (
                <>
                  <NumberField label={t("pricing.includedUsers")} value={config.nestoIncludedUsers} set={(value) => update((current) => ({ ...current, nestoIncludedUsers: value }))} />
                  <NumberField label={t("pricing.includedProjects")} value={config.nestoProjects.included} set={(value) => update((current) => ({ ...current, nestoProjects: { ...current.nestoProjects, included: Math.max(1, value) } }))} />
                  <MoneyField label={t("pricing.activeProjectMonth")} cents={config.nestoProjects.additionalMonthlyCents} set={(value) => update((current) => ({ ...current, nestoProjects: { ...current.nestoProjects, additionalMonthlyCents: value } }))} />
                </>
              ) : null}
            </EditorGroup>
          ))}
        </div>

        <section aria-label={t("pricing.modules")}>
          <h3 className="mb-1 text-table font-semibold uppercase tracking-wide text-fg-subtle">{t("pricing.modules")}</h3>
          <p className="mb-3 text-table text-fg-muted">{t("pricing.modulesNote")}</p>
          <div className="overflow-x-auto">
            <Table flush aria-label={t("pricing.modulesTable")}>
              <TableHead><TableRow><TableHeaderCell>{t("pricing.col.module")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.public")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.tier")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.addon")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.inPlatform")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.inRozaris")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.locked")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.needs")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.absorbs")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.order")}</TableHeaderCell></TableRow></TableHead>
              <TableBody>
                {config.modules.map((row) => {
                  const inFoundation = (id: Foundation, on: boolean) => setModule(row.id, { includedInFoundations: on ? [...new Set([...row.includedInFoundations, id])] : row.includedInFoundations.filter((item) => item !== id) });
                  return (
                    <TableRow key={row.id} data-testid="pricing-module-row">
                      <TableCell><Input aria-label={t("pricing.aria.name", { id: row.id })} value={row.name} onChange={(event) => setModule(row.id, { name: event.target.value })} className="min-w-40" /><p className="mt-1 font-mono text-micro text-fg-subtle">{row.id} · {row.group}</p></TableCell>
                      <TableCell><input type="checkbox" aria-label={t("pricing.aria.public", { id: row.id })} checked={row.enabled && row.public} onChange={(event) => setModule(row.id, { public: event.target.checked, enabled: event.target.checked || row.enabled })} /></TableCell>
                      <TableCell><select aria-label={t("pricing.aria.tier", { id: row.id })} className="h-9 rounded-md border border-line-strong bg-surface px-2 text-table" value={row.tier} onChange={(event) => setModule(row.id, { tier: event.target.value as PricingModule["tier"] })}>{["S", "A", "B", "C", "ACCESS"].map((tier) => <option key={tier}>{tier}</option>)}</select></TableCell>
                      <TableCell><Input aria-label={t("pricing.aria.price", { id: row.id })} type="number" min={0} step="0.01" className="w-28" value={row.monthlyPriceCents / 100} onChange={(event) => setModule(row.id, { monthlyPriceCents: Math.max(0, Math.round(event.target.valueAsNumber * 100) || 0) })} /></TableCell>
                      <TableCell><input type="checkbox" aria-label={t("pricing.aria.inPlatform", { id: row.id })} checked={row.includedInFoundations.includes("NESTO_PLATFORM")} onChange={(event) => inFoundation("NESTO_PLATFORM", event.target.checked)} /></TableCell>
                      <TableCell><input type="checkbox" aria-label={t("pricing.aria.inRozaris", { id: row.id })} checked={row.includedInFoundations.includes("ROZARIS")} onChange={(event) => inFoundation("ROZARIS", event.target.checked)} /></TableCell>
                      <TableCell><input type="checkbox" aria-label={t("pricing.aria.locked", { id: row.id })} checked={row.lockedWhenIncluded} onChange={(event) => setModule(row.id, { lockedWhenIncluded: event.target.checked })} /></TableCell>
                      <TableCell><Input aria-label={t("pricing.aria.dependencies", { id: row.id })} className="w-36" value={row.dependencies.join(", ")} onChange={(event) => setModule(row.id, { dependencies: ids(event.target.value) })} /></TableCell>
                      <TableCell><Input aria-label={t("pricing.aria.absorbs", { id: row.id })} className="w-36" value={row.absorbs.join(", ")} onChange={(event) => setModule(row.id, { absorbs: ids(event.target.value) })} /></TableCell>
                      <TableCell><Input aria-label={t("pricing.aria.order", { id: row.id })} type="number" className="w-20" value={row.sortOrder} onChange={(event) => setModule(row.id, { sortOrder: Math.max(0, Math.round(event.target.valueAsNumber) || 0) })} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <EditorGroup title={t("pricing.rozarisClasses")}>
            {(["BASIC", "LARGE", "VILLAGE"] as const).map((key) => (
              <React.Fragment key={key}>
                <MoneyField label={t("pricing.months24", { name: config.rozaris.classes[key].name })} cents={config.rozaris.classes[key].monthly24Cents} set={(value) => setClass(key, { monthly24Cents: value })} />
                <MoneyField label={t("pricing.months12", { name: config.rozaris.classes[key].name })} cents={config.rozaris.classes[key].monthly12Cents} set={(value) => setClass(key, { monthly12Cents: value })} />
                <NumberField label={t("pricing.classUsers", { name: config.rozaris.classes[key].name })} value={config.rozaris.classes[key].includedUsers} set={(value) => setClass(key, { includedUsers: value })} />
              </React.Fragment>
            ))}
            <Field label={t("pricing.usersAcrossProjects")}>
              <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg" value={config.rozaris.userAllowanceMode} onChange={(event) => update((current) => ({ ...current, rozaris: { ...current.rozaris, userAllowanceMode: event.target.value as PricingConfig["rozaris"]["userAllowanceMode"] } }))}>
                <option value="MAX_PROJECT">{t("pricing.allowance.MAX_PROJECT")}</option><option value="SUM_PROJECTS">{t("pricing.allowance.SUM_PROJECTS")}</option><option value="FIRST_PROJECT_ONLY">{t("pricing.allowance.FIRST_PROJECT_ONLY")}</option>
              </select>
            </Field>
          </EditorGroup>
          <EditorGroup title={t("pricing.indexation")}>
            <label className="flex items-center gap-3 text-table text-fg"><input type="checkbox" checked={config.indexation.enabled} onChange={(event) => update((current) => ({ ...current, indexation: { ...current.indexation, enabled: event.target.checked } }))} /> {t("pricing.hicpEnabled")}</label>
            <Field label={t("pricing.referenceIndex")}><Input value={config.indexation.source} onChange={(event) => update((current) => ({ ...current, indexation: { ...current.indexation, source: event.target.value.toUpperCase().replaceAll(" ", "_") } }))} /></Field>
            <NumberField label={t("pricing.floorPercent")} value={config.indexation.floorPercent} set={(value) => update((current) => ({ ...current, indexation: { ...current.indexation, floorPercent: value } }))} />
            <NumberField label={t("pricing.capPercent")} value={config.indexation.capPercent} set={(value) => update((current) => ({ ...current, indexation: { ...current.indexation, capPercent: value } }))} />
            <NumberField label={t("pricing.firstAdjustmentMonth")} value={config.indexation.firstAdjustmentMonth} set={(value) => update((current) => ({ ...current, indexation: { ...current.indexation, firstAdjustmentMonth: value } }))} />
            <Field label={t("pricing.effectiveDate")}><Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></Field>
          </EditorGroup>
        </div>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-md bg-danger-soft p-3 text-table text-danger-strong">{error}</p> : null}

      <Dialog
        open={publishOpen}
        onOpenChange={(value) => {
          setPublishOpen(value);
          // A discarded reason goes once the dialog has closed through its guard.
          if (!value) setReason("");
        }}
      >
        <DialogContent>
          {/* Publishing is the only way forward for a typed reason: Stay or Discard (AUD-03 §4). */}
          <DialogEditor label={t("pricing.publishingLabel", { code: version.versionCode })} module="pricing" dirty={reason !== ""} saving={pending} unresolved={false} workflow="Publish" />
          <DialogTitle>{t("pricing.publishTitle", { code: version.versionCode })}</DialogTitle>
          <DialogDescription>{t("pricing.publishDescription")}</DialogDescription>
          <div className="mt-5"><Field label={t("pricing.reason")}><Textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("pricing.reasonPlaceholder")} /></Field></div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">{t("pricing.cancel")}</Button>
            </DialogClose>
            <Button type="button" onClick={() => void publishVersion()} disabled={pending || reason.trim().length < 3}>{pending ? t("pricing.publishing") : t("pricing.publishVersion")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PromotionEditor({ promotion }: { promotion: Promotion }) {
  const t = useTranslations("adminOrgs");
  const [name, setName] = React.useState(promotion.name);
  const [status, setStatus] = React.useState<"ACTIVE" | "INACTIVE">(promotion.status);
  const [config, setConfig] = React.useState<PricingPromotionConfig>(promotion.configJson);
  const [startsAt, setStartsAt] = React.useState(promotion.startsAt?.slice(0, 10) ?? "");
  const [endsAt, setEndsAt] = React.useState(promotion.endsAt?.slice(0, 10) ?? "");
  const [pending, setPending] = React.useState(false);
  const router = useRouter();
  const toast = useToast();
  const free = config.periods[0] ?? { months: 0, discountPercent: 100 };
  const reduced = config.periods[1] ?? { months: 0, discountPercent: 50 };

  const setPeriod = (index: number, patch: Partial<{ months: number; discountPercent: number }>) => {
    setConfig((current) => ({
      ...current,
      periods: [0, 1].map((item) => ({
        ...(current.periods[item] ?? (item === 0 ? free : reduced)),
        ...(item === index ? patch : {}),
      })),
    }));
  };

  const edits = usePricingEditor(t("pricing.promotionLabel", { code: promotion.code }), [name, status, config, startsAt, endsAt], () => save());

  /** The promotion's one save path: its Save button and "Save and continue" alike (AUD-03 §3). */
  async function save(): Promise<SaveOutcome> {
    const submitted = edits.key;
    setPending(true);
    edits.editor.setSaving(true);
    edits.editor.setUnresolved(false);
    try {
      const periods = [
        { months: free.months, discountPercent: 100 },
        { months: reduced.months, discountPercent: reduced.discountPercent },
      ].filter((period) => period.months > 0);
      await adminRequest(`/api/platform/pricing/promotions/${promotion.id}`, "PATCH", {
        name,
        status,
        config: { ...config, enabled: status === "ACTIVE", periods },
        startsAt: startsAt ? new Date(`${startsAt}T00:00:00.000Z`).toISOString() : null,
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59.999Z`).toISOString() : null,
      }, t("pricing.refusalFallback"));
      edits.accept(submitted);
      toast({ title: t("pricing.promotionSaved"), tone: "success" });
      router.refresh();
      return { kind: "committed" };
    } catch (failure) {
      const outcome = failureOutcome(failure);
      edits.editor.setUnresolved(outcome.kind === "unknown");
      toast({ title: failure instanceof Error ? failure.message : t("pricing.promotionSaveFailed"), tone: "danger" });
      return outcome;
    } finally {
      setPending(false);
      edits.editor.setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <Field label={t("pricing.code")}><Input value={promotion.code} readOnly /></Field>
      <Field label={t("pricing.name")}><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label={t("pricing.status")}>
        <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg" value={status} onChange={(event) => setStatus(event.target.value as "ACTIVE" | "INACTIVE")}>
          <option value="ACTIVE">{t("pricing.active")}</option><option value="INACTIVE">{t("pricing.inactive")}</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("pricing.eligibleFoundation")}>
          <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg" value={config.product} onChange={(event) => setConfig((current) => ({ ...current, product: event.target.value as PricingPromotionConfig["product"] }))}>
            <option value="NESTO_PLATFORM">{t("pricing.foundationPlatform")}</option><option value="ROZARIS">ROZARIS</option>
          </select>
        </Field>
        <Field label={t("pricing.eligibleTerm")}>
          <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg" value={config.requiredContractMonths} onChange={(event) => setConfig((current) => ({ ...current, requiredContractMonths: event.target.value === "12" ? 12 : 24 }))}>
            <option value="12">{t("pricing.term12")}</option><option value="24">{t("pricing.term24")}</option>
          </select>
        </Field>
        <NumberField label={t("pricing.freeMonths")} value={free.months} set={(value) => setPeriod(0, { months: value, discountPercent: 100 })} />
        <NumberField label={t("pricing.discountMonths")} value={reduced.months} set={(value) => setPeriod(1, { months: value })} />
        <NumberField label={t("pricing.discountPercent")} value={reduced.discountPercent} set={(value) => setPeriod(1, { discountPercent: value })} />
        <Field label={t("pricing.starts")}><Input type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field>
        <Field label={t("pricing.endsOptional")}><Input type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => void save()} disabled={pending}><Save /> {pending ? t("pricing.saving") : t("pricing.savePromotion")}</Button>
        <UnsavedIndicator save={{ editor: edits.editor, pending, saved: null }} />
      </div>
    </div>
  );
}

function VersionHistory({ versions }: { versions: PricingAdminData["versions"] }) {
  const t = useTranslations("adminOrgs");
  return <Card className="p-5"><h2 className="text-card font-semibold text-fg">{t("pricing.versionHistory")}</h2><div className="mt-4"><Table flush aria-label={t("pricing.versionsTable")}><TableHead><TableRow><TableHeaderCell>{t("pricing.col.version")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.status")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.effective")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.published")}</TableHeaderCell></TableRow></TableHead><TableBody>{versions.map((version) => <TableRow key={version.id}><TableCell className="font-medium text-fg">{version.versionCode}</TableCell><TableCell><Badge tone={version.status === "ACTIVE" ? "success" : version.status === "DRAFT" ? "warning" : "neutral"}>{t(`pricing.versionStatus.${version.status}`)}</Badge></TableCell><TableCell>{new Date(version.effectiveFrom).toLocaleDateString()}</TableCell><TableCell>{version.publishedAt ? new Date(version.publishedAt).toLocaleDateString() : "—"}</TableCell></TableRow>)}</TableBody></Table></div></Card>;
}

function RecentQuotes({ quotes }: { quotes: PricingAdminData["recentQuotes"] }) {
  const t = useTranslations("adminOrgs");
  return <Card className="p-5"><div className="flex items-center justify-between"><div><h2 className="text-card font-semibold text-fg">{t("pricing.recentQuotes")}</h2><p className="mt-1 text-table text-fg-muted">{t("pricing.recentQuotesNote")}</p></div><CheckCircle2 className="size-5 text-success-strong" /></div><div className="mt-4"><Table flush label={t("pricing.quotesTable")} aria-label={t("pricing.quotesTable")}><TableHead><TableRow><TableHeaderCell>{t("pricing.col.reference")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.product")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.monthly")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.term")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.status")}</TableHeaderCell><TableHeaderCell>{t("pricing.col.leads")}</TableHeaderCell></TableRow></TableHead><TableBody>{quotes.map((quote) => <TableRow key={quote.id}><TableCell className="font-mono text-fg">{quote.reference}</TableCell><TableCell>{quote.productMode}</TableCell><TableCell>€{quote.standardMonthly.toLocaleString()}</TableCell><TableCell>{t("pricing.termMonths", { count: quote.contractMonths })}</TableCell><TableCell><Badge tone={quote.status === "PROPOSAL_REQUESTED" ? "success" : "neutral"}>{t(`pricing.quoteStatus.${quote.status}`)}</Badge></TableCell><TableCell>{quote.leads}</TableCell></TableRow>)}</TableBody></Table>{quotes.length === 0 ? <p className="py-8 text-center text-table text-fg-muted">{t("pricing.noQuotes")}</p> : null}</div></Card>;
}

function EditorGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-3 text-table font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{children}</div></section>; }
function MoneyField({ label, cents, set }: { label: string; cents: number; set: (value: number) => void }) { const t = useTranslations("adminOrgs"); return <Field label={t("pricing.euro", { label })}><Input type="number" inputMode="decimal" min={0} step="0.01" value={cents / 100} onChange={(event) => set(Math.max(0, Math.round(event.target.valueAsNumber * 100) || 0))} /></Field>; }
function NumberField({ label, value, set }: { label: string; value: number; set: (value: number) => void }) { return <Field label={label}><Input type="number" inputMode="numeric" min={0} step={1} value={value} onChange={(event) => set(Math.max(0, Math.round(event.target.valueAsNumber) || 0))} /></Field>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-meta font-medium text-fg-muted">{label}<span className="mt-1.5 block">{children}</span></label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><dt className="text-meta text-fg-subtle">{label}</dt><dd className="mt-1 text-table font-semibold text-fg">{value}</dd></div>; }
