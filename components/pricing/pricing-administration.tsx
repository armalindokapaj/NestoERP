"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CirclePlus, Save, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { getPricingAdministration } from "@/lib/modules/pricing/pricing.service";
import type { PricingConfig, PricingPromotionConfig } from "@/lib/modules/pricing/pricing.types";

type PricingAdminData = Awaited<ReturnType<typeof getPricingAdministration>>;
type Version = PricingAdminData["versions"][number];
type Promotion = PricingAdminData["promotions"][number];

async function adminRequest<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error?.message ?? "The pricing change could not be saved.");
  return payload.data;
}

export function PricingAdministration({ data }: { data: PricingAdminData }) {
  const active = data.versions.find((version) => version.status === "ACTIVE");
  const drafts = data.versions.filter((version) => version.status === "DRAFT");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-card font-semibold text-fg">Active price book</h2>
                {active ? <Badge tone="success">{active.versionCode}</Badge> : <Badge tone="danger">Unavailable</Badge>}
              </div>
              <p className="mt-1 text-table text-fg-muted">Every new public calculation resolves this version on the server.</p>
            </div>
            <CreateDraft />
          </div>
          {active ? <PriceBookSummary config={active.configJson} /> : null}
        </Card>

        <Card className="p-5">
          <h2 className="text-card font-semibold text-fg">Current promotion</h2>
          <p className="mt-1 text-table text-fg-muted">Promotions are independently enabled and date-bound.</p>
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
  const eur = (cents: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(cents / 100);
  return (
    <dl className="mt-5 grid gap-4 border-t border-line pt-5 sm:grid-cols-3">
      <Summary label="ERP base" value={`${eur(config.nestoERP.baseMonthlyCents)} / mo`} />
      <Summary label="Company add-on" value={`${eur(config.nestoERP.additionalGroupCompanyMonthlyCents)} / mo`} />
      <Summary label="Project add-on" value={`${eur(config.nestoERP.additionalProjectMonthlyCents)} / mo`} />
      <Summary label="Included users" value={String(config.nestoERP.includedUsersPerFullCompany)} />
      <Summary label="User pack" value={`${config.nestoERP.userPackSize} / ${eur(config.nestoERP.userPackMonthlyCents)}`} />
      <Summary label="ROZARIS Basic 24" value={`${eur(config.rozaris.projectTypes.basic.monthly24Cents)} / mo`} />
    </dl>
  );
}

function CreateDraft() {
  const [open, setOpen] = React.useState(false);
  const [versionCode, setVersionCode] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await adminRequest("/api/platform/pricing/versions", "POST", { versionCode });
      toast({ title: "Pricing draft created.", tone: "success" });
      setOpen(false);
      setVersionCode("");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Draft could not be created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}><CirclePlus /> New version</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Create pricing version</DialogTitle>
          <DialogDescription>The active configuration is copied into a safe draft. Existing quotes remain unchanged.</DialogDescription>
          <form onSubmit={create} className="mt-5">
            <Field label="Version code">
              <Input required pattern="\d{4}\.\d{2}(\.\d+)?" placeholder="2027.01" value={versionCode} onChange={(event) => setVersionCode(event.target.value)} />
            </Field>
            {error ? <p role="alert" className="mt-3 text-table text-danger-strong">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create draft"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PricingVersionEditor({ version }: { version: Version }) {
  const [config, setConfig] = React.useState<PricingConfig>(version.configJson);
  const [effectiveFrom, setEffectiveFrom] = React.useState(version.effectiveFrom.slice(0, 10));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const router = useRouter();
  const toast = useToast();

  const setERP = <K extends keyof PricingConfig["nestoERP"]>(key: K, value: PricingConfig["nestoERP"][K]) => {
    setConfig((current) => ({ ...current, nestoERP: { ...current.nestoERP, [key]: value } }));
  };
  const setRozaris = (type: "basic" | "large" | "village", term: "monthly12Cents" | "monthly24Cents", value: number) => {
    setConfig((current) => ({
      ...current,
      rozaris: { projectTypes: { ...current.rozaris.projectTypes, [type]: { ...current.rozaris.projectTypes[type], [term]: value } } },
    }));
  };

  async function save() {
    setPending(true);
    setError(null);
    try {
      await adminRequest(`/api/platform/pricing/versions/${version.id}`, "PATCH", {
        config,
        effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`).toISOString(),
      });
      toast({ title: "Pricing draft saved.", tone: "success" });
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Draft could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function publishVersion() {
    setPending(true);
    setError(null);
    try {
      await adminRequest(`/api/platform/pricing/versions/${version.id}/publish`, "POST", { confirmed: true, reason });
      toast({ title: `${version.versionCode} is now active.`, tone: "success" });
      setPublishOpen(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Version could not be published.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><h2 className="text-card font-semibold text-fg">Draft {version.versionCode}</h2><Badge tone="warning">DRAFT</Badge></div>
          <p className="mt-1 text-table text-fg-muted">Edit, review, then publish. Published versions are immutable.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => void save()} disabled={pending}><Save /> Save draft</Button>
          <Button type="button" onClick={() => setPublishOpen(true)} disabled={pending}><Send /> Publish</Button>
        </div>
      </div>

      <div className="mt-5 grid gap-6 border-t border-line pt-5 xl:grid-cols-3">
        <EditorGroup title="NESTO ERP">
          <MoneyField label="Base monthly" cents={config.nestoERP.baseMonthlyCents} set={(value) => setERP("baseMonthlyCents", value)} />
          <NumberField label="Included companies" value={config.nestoERP.includedCompanies} set={(value) => setERP("includedCompanies", value)} />
          <NumberField label="Included projects" value={config.nestoERP.includedProjects} set={(value) => setERP("includedProjects", value)} />
          <NumberField label="Users per full company" value={config.nestoERP.includedUsersPerFullCompany} set={(value) => setERP("includedUsersPerFullCompany", value)} />
          <MoneyField label="Group company / month" cents={config.nestoERP.additionalGroupCompanyMonthlyCents} set={(value) => setERP("additionalGroupCompanyMonthlyCents", value)} />
          <MoneyField label="JV company / month" cents={config.nestoERP.additionalJVCompanyMonthlyCents} set={(value) => setERP("additionalJVCompanyMonthlyCents", value)} />
          <MoneyField label="Documents-only / month" cents={config.nestoERP.documentsOnlyCompanyMonthlyCents} set={(value) => setERP("documentsOnlyCompanyMonthlyCents", value)} />
          <MoneyField label="Active project / month" cents={config.nestoERP.additionalProjectMonthlyCents} set={(value) => setERP("additionalProjectMonthlyCents", value)} />
          <NumberField label="User pack size" value={config.nestoERP.userPackSize} set={(value) => setERP("userPackSize", value)} />
          <MoneyField label="User pack / month" cents={config.nestoERP.userPackMonthlyCents} set={(value) => setERP("userPackMonthlyCents", value)} />
        </EditorGroup>

        <EditorGroup title="ROZARIS">
          <MoneyField label="Basic · 24 months" cents={config.rozaris.projectTypes.basic.monthly24Cents} set={(value) => setRozaris("basic", "monthly24Cents", value)} />
          <MoneyField label="Basic · 12 months" cents={config.rozaris.projectTypes.basic.monthly12Cents} set={(value) => setRozaris("basic", "monthly12Cents", value)} />
          <MoneyField label="Large · 24 months" cents={config.rozaris.projectTypes.large.monthly24Cents} set={(value) => setRozaris("large", "monthly24Cents", value)} />
          <MoneyField label="Large · 12 months" cents={config.rozaris.projectTypes.large.monthly12Cents} set={(value) => setRozaris("large", "monthly12Cents", value)} />
          <MoneyField label="Village · 24 months" cents={config.rozaris.projectTypes.village.monthly24Cents} set={(value) => setRozaris("village", "monthly24Cents", value)} />
          <MoneyField label="Village · 12 months" cents={config.rozaris.projectTypes.village.monthly12Cents} set={(value) => setRozaris("village", "monthly12Cents", value)} />
        </EditorGroup>

        <EditorGroup title="Indexation & activation">
          <label className="flex items-center gap-3 text-table text-fg"><input type="checkbox" checked={config.indexation.enabled} onChange={(event) => setConfig((current) => ({ ...current, indexation: { ...current.indexation, enabled: event.target.checked } }))} /> HICP enabled</label>
          <Field label="Reference index"><Input value={config.indexation.source} onChange={(event) => setConfig((current) => ({ ...current, indexation: { ...current.indexation, source: event.target.value.toUpperCase().replaceAll(" ", "_") } }))} /></Field>
          <NumberField label="Floor percent" value={config.indexation.floorPercent} set={(value) => setConfig((current) => ({ ...current, indexation: { ...current.indexation, floorPercent: value } }))} />
          <NumberField label="Cap percent" value={config.indexation.capPercent} set={(value) => setConfig((current) => ({ ...current, indexation: { ...current.indexation, capPercent: value } }))} />
          <NumberField label="First adjustment month" value={config.indexation.firstAdjustmentMonth} set={(value) => setConfig((current) => ({ ...current, indexation: { ...current.indexation, firstAdjustmentMonth: value } }))} />
          <Field label="Effective date"><Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></Field>
        </EditorGroup>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-md bg-danger-soft p-3 text-table text-danger-strong">{error}</p> : null}

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogTitle>Publish Pricing Version {version.versionCode}?</DialogTitle>
          <DialogDescription>This will affect all new public pricing calculations. Existing saved quotes will not change.</DialogDescription>
          <div className="mt-5"><Field label="Reason"><Textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this pricing version is being published" /></Field></div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPublishOpen(false)}>Cancel</Button>
            <Button type="button" onClick={() => void publishVersion()} disabled={pending || reason.trim().length < 3}>{pending ? "Publishing…" : "Publish version"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PromotionEditor({ promotion }: { promotion: Promotion }) {
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

  async function save() {
    setPending(true);
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
      });
      toast({ title: "Promotion saved.", tone: "success" });
      router.refresh();
    } catch (failure) {
      toast({ title: failure instanceof Error ? failure.message : "Promotion could not be saved.", tone: "danger" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <Field label="Code"><Input value={promotion.code} readOnly /></Field>
      <Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Status">
        <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg" value={status} onChange={(event) => setStatus(event.target.value as "ACTIVE" | "INACTIVE")}>
          <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Eligible product">
          <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg" value={config.product} onChange={(event) => setConfig((current) => ({ ...current, product: event.target.value as PricingPromotionConfig["product"] }))}>
            <option value="NESTO_ERP">NESTO ERP</option><option value="ROZARIS_ONLY">ROZARIS only</option>
          </select>
        </Field>
        <Field label="Eligible term">
          <select className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body text-fg" value={config.requiredContractMonths} onChange={(event) => setConfig((current) => ({ ...current, requiredContractMonths: event.target.value === "12" ? 12 : 24 }))}>
            <option value="12">12 months</option><option value="24">24 months</option>
          </select>
        </Field>
        <NumberField label="Free months" value={free.months} set={(value) => setPeriod(0, { months: value, discountPercent: 100 })} />
        <NumberField label="Discount months" value={reduced.months} set={(value) => setPeriod(1, { months: value })} />
        <NumberField label="Discount percent" value={reduced.discountPercent} set={(value) => setPeriod(1, { discountPercent: value })} />
        <Field label="Starts"><Input type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field>
        <Field label="Ends (optional)"><Input type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></Field>
      </div>
      <Button type="button" variant="secondary" onClick={() => void save()} disabled={pending}><Save /> {pending ? "Saving…" : "Save promotion"}</Button>
    </div>
  );
}

function VersionHistory({ versions }: { versions: PricingAdminData["versions"] }) {
  return <Card className="p-5"><h2 className="text-card font-semibold text-fg">Version history</h2><div className="mt-4"><Table flush aria-label="Pricing versions"><TableHead><TableRow><TableHeaderCell>Version</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Effective</TableHeaderCell><TableHeaderCell>Published</TableHeaderCell></TableRow></TableHead><TableBody>{versions.map((version) => <TableRow key={version.id}><TableCell className="font-medium text-fg">{version.versionCode}</TableCell><TableCell><Badge tone={version.status === "ACTIVE" ? "success" : version.status === "DRAFT" ? "warning" : "neutral"}>{version.status}</Badge></TableCell><TableCell>{new Date(version.effectiveFrom).toLocaleDateString()}</TableCell><TableCell>{version.publishedAt ? new Date(version.publishedAt).toLocaleDateString() : "—"}</TableCell></TableRow>)}</TableBody></Table></div></Card>;
}

function RecentQuotes({ quotes }: { quotes: PricingAdminData["recentQuotes"] }) {
  return <Card className="p-5"><div className="flex items-center justify-between"><div><h2 className="text-card font-semibold text-fg">Recent saved quotes</h2><p className="mt-1 text-table text-fg-muted">Quotes are created only when a visitor reaches Review.</p></div><CheckCircle2 className="size-5 text-success-strong" /></div><div className="mt-4"><Table flush aria-label="Recent pricing quotes"><TableHead><TableRow><TableHeaderCell>Reference</TableHeaderCell><TableHeaderCell>Product</TableHeaderCell><TableHeaderCell>Monthly</TableHeaderCell><TableHeaderCell>Term</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Leads</TableHeaderCell></TableRow></TableHead><TableBody>{quotes.map((quote) => <TableRow key={quote.id}><TableCell className="font-mono text-fg">{quote.reference}</TableCell><TableCell>{quote.productMode}</TableCell><TableCell>€{quote.standardMonthly.toLocaleString()}</TableCell><TableCell>{quote.contractMonths} mo</TableCell><TableCell><Badge tone={quote.status === "PROPOSAL_REQUESTED" ? "success" : "neutral"}>{quote.status}</Badge></TableCell><TableCell>{quote.leads}</TableCell></TableRow>)}</TableBody></Table>{quotes.length === 0 ? <p className="py-8 text-center text-table text-fg-muted">No saved quotes yet.</p> : null}</div></Card>;
}

function EditorGroup({ title, children }: { title: string; children: React.ReactNode }) { return <section><h3 className="mb-3 text-table font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{children}</div></section>; }
function MoneyField({ label, cents, set }: { label: string; cents: number; set: (value: number) => void }) { return <Field label={`${label} (€)`}><Input type="number" min={0} step="0.01" value={cents / 100} onChange={(event) => set(Math.max(0, Math.round(event.target.valueAsNumber * 100) || 0))} /></Field>; }
function NumberField({ label, value, set }: { label: string; value: number; set: (value: number) => void }) { return <Field label={label}><Input type="number" min={0} step={1} value={value} onChange={(event) => set(Math.max(0, Math.round(event.target.valueAsNumber) || 0))} /></Field>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-meta font-medium text-fg-muted">{label}<span className="mt-1.5 block">{children}</span></label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><dt className="text-meta text-fg-subtle">{label}</dt><dd className="mt-1 text-table font-semibold text-fg">{value}</dd></div>; }
