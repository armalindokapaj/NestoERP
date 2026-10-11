"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Layers3, Lock, Minus, Orbit, Plus, RefreshCw, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { numberText } from "@/lib/i18n/format";
import { fill, type PricingCopy } from "@/lib/i18n/site/pricing-configurator";
import { defaultRequest, MODULE_GROUPS } from "@/lib/modules/pricing/pricing.config";
import { calculatePricing, hasRozarisProjects, isIncluded, isOffered, resolveModules } from "@/lib/modules/pricing/pricing.engine";
import type { Foundation, PricingConfig, PricingModule, PricingQuote, PricingRequest, PublicPricingConfig, RozarisClass } from "@/lib/modules/pricing/pricing.types";
import { cn } from "@/lib/utils/cn";

/*
 * The public pricing configurator (Modular Pricing PRD §4-§54). The page is
 * the configurator: seven steps, the live estimate beside them, the address
 * carrying the configuration. The browser estimates with the same engine; the
 * server's answer replaces it.
 */

const STEPS = ["foundation", "modules", "companies", "projects", "users", "contract", "review"] as const;
type Step = (typeof STEPS)[number];
const REVIEW = STEPS.indexOf("review");
const CLASSES: RozarisClass[] = ["BASIC", "LARGE", "VILLAGE"];
type ProposalType = "FORMAL_PROPOSAL" | "TALK_TO_SALES" | "THREE_D_PRODUCTION";

/** The public config as a price book the engine can run (technical modules are server-only and simply absent here). */
function priceBookOf(config: PublicPricingConfig): PricingConfig {
  return {
    schemaVersion: 2, version: config.pricingVersion, currency: "EUR", foundations: config.foundations, modules: config.modules,
    companies: config.companies, nestoProjects: config.nestoProjects, nestoIncludedUsers: config.nestoIncludedUsers,
    rozaris: config.rozaris, users: config.users, indexation: config.indexation,
  };
}

function promotionFor(config: PublicPricingConfig, foundation: Foundation, months: 12 | 24, requested?: string | null) {
  const eligible = config.promotions.filter((row) => row.enabled && row.product === foundation && row.requiredContractMonths === months);
  return eligible.find((row) => row.code === requested) ?? eligible[0] ?? null;
}

const bounded = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min);
let projectSeq = 0;
const newProjectId = () => `p${Date.now().toString(36)}${(projectSeq++).toString(36)}`;

function withPromotion(config: PublicPricingConfig, input: PricingRequest, requested?: string | null): PricingRequest {
  return { ...input, promotionCode: promotionFor(config, input.foundation, input.contractMonths, requested ?? input.promotionCode)?.code ?? null };
}

/**
 * The address → a configuration (§37, §38). Old links (`mode=erp`, per-class
 * ROZARIS counts, `step=product`) are read and rewritten in the new form.
 */
function readUrl(config: PublicPricingConfig): { input: PricingRequest; step: number; legacy: boolean } {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const legacy = mode !== null || ["product", "rozaris"].includes(params.get("step") ?? "") || ["basic", "large", "village", "group"].some((key) => params.has(key));
  const foundation: Foundation = (params.get("foundation") ?? (mode === "rozaris" ? "rozaris" : "nesto")) === "rozaris" ? "ROZARIS" : "NESTO_PLATFORM";
  const base = defaultRequest(foundation, config);
  const count = (key: string, max = 500) => bounded(Number(params.get(key) ?? 0), 0, max);
  let rozaris: RozarisClass[] = (params.get("rozaris") ?? params.get("projectType") ?? "").split(",").map((value) => value.trim().toUpperCase()).filter((value): value is RozarisClass => (CLASSES as string[]).includes(value));
  if (!params.get("rozaris") && !params.get("projectType")) {
    rozaris = [...Array(count("basic", 50)).fill("BASIC"), ...Array(count("large", 50)).fill("LARGE"), ...Array(count("village", 50)).fill("VILLAGE")];
  }
  if (foundation === "ROZARIS" && rozaris.length === 0) rozaris = ["BASIC"];
  const input: PricingRequest = {
    foundation,
    modules: (params.get("modules") ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean),
    companies: { fullGroup: count("group") || Math.max(0, count("companies") - 1), jointVenture: count("jv"), documentsOnly: count("docs") },
    ...(foundation === "NESTO_PLATFORM" ? { nestoProjects: { active: bounded(Number(params.get("projects") ?? config.nestoProjects.included), 1, 1_000) } } : {}),
    rozarisProjects: rozaris.slice(0, 50).map((type) => ({ tempId: newProjectId(), type })),
    activeUsers: bounded(Number(params.get("users") ?? base.activeUsers), 1, 100_000),
    contractMonths: params.get("term") === "12" ? 12 : 24,
    promotionCode: params.get("promo"),
  };
  const stepName = ({ product: "foundation", rozaris: "projects" } as Record<string, string>)[params.get("step") ?? ""] ?? params.get("step");
  const step = STEPS.indexOf(stepName as Step);
  return { input: withPromotion(config, input, params.get("promo")), step: step >= 0 ? step : 0, legacy };
}

function urlFor(input: PricingRequest, step: number) {
  const params = new URLSearchParams();
  params.set("foundation", input.foundation === "ROZARIS" ? "rozaris" : "nesto");
  if (input.modules.length) params.set("modules", input.modules.map((id) => id.toLowerCase()).join(","));
  if (input.companies.fullGroup) params.set("group", String(input.companies.fullGroup));
  if (input.companies.jointVenture) params.set("jv", String(input.companies.jointVenture));
  if (input.companies.documentsOnly) params.set("docs", String(input.companies.documentsOnly));
  if (input.nestoProjects) params.set("projects", String(input.nestoProjects.active));
  if (input.rozarisProjects?.length) params.set("rozaris", input.rozarisProjects.map((project) => project.type.toLowerCase()).join(","));
  params.set("users", String(input.activeUsers));
  params.set("term", String(input.contractMonths));
  if (input.promotionCode) params.set("promo", input.promotionCode);
  params.set("step", STEPS[step]);
  return `${window.location.pathname}?${params}${window.location.hash}`;
}

/** Throws the server's own message; when it gave none the error carries none, and the caller words it for its reader. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error?.message ?? "");
  return payload.data;
}

function track(event: string, input: PricingRequest, extra: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  // Configuration only — never a name, email or phone (§50).
  const properties = { foundation: input.foundation, moduleCount: input.modules.length, contractMonths: input.contractMonths, companyCount: 1 + input.companies.fullGroup + input.companies.jointVenture, rozarisProjects: input.rozarisProjects?.map((project) => project.type) ?? [], userCount: input.activeUsers, ...extra };
  window.dispatchEvent(new CustomEvent("nesto:analytics", { detail: { event, properties } }));
}

type Ctx = { config: PublicPricingConfig; book: PricingConfig; input: PricingRequest; quote: PricingQuote; t: PricingCopy; money: (cents: number) => string; change: (next: PricingRequest, event?: string, extra?: Record<string, unknown>) => void };

export function PricingWizard({ initialConfig, copy, locale }: { initialConfig: PublicPricingConfig; copy: PricingCopy; locale: string }) {
  const t = copy;
  const book = React.useMemo(() => priceBookOf(initialConfig), [initialConfig]);
  // Never `Intl` with the reader's locale: Chrome has no Albanian data, so the server and the browser would print two different prices.
  const money = React.useCallback((cents: number) => numberText(cents / 100, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }, locale === "sq" ? "sq" : "en", "en"), [locale]);
  const initial = React.useMemo(() => withPromotion(initialConfig, defaultRequest("ROZARIS", initialConfig)), [initialConfig]);
  const [input, setInput] = React.useState<PricingRequest>(initial);
  const [step, setStep] = React.useState(0);
  const [reached, setReached] = React.useState(0);
  const stepRef = React.useRef(step);
  stepRef.current = step;
  const estimate = React.useCallback((next: PricingRequest) => calculatePricing(next, book, promotionFor(initialConfig, next.foundation, next.contractMonths, next.promotionCode)), [book, initialConfig]);
  const [quote, setQuote] = React.useState<PricingQuote>(() => estimate(initial));
  const lastGood = React.useRef(quote);
  const [hydrated, setHydrated] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [proposal, setProposal] = React.useState<ProposalType | null>(null);
  const [savedFor, setSavedFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    const state = readUrl(initialConfig);
    setInput(state.input);
    setStep(state.step);
    setReached(state.step);
    setQuote(estimate(state.input));
    // An old link is rewritten once in the new form (§38).
    window.history.replaceState({ pricingStep: state.step }, "", urlFor(state.input, state.step));
    setHydrated(true);
    track("pricing_viewed", state.input, { legacyLink: state.legacy });
    const onPop = () => { const next = readUrl(initialConfig); setInput(next.input); setStep(next.step); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [initialConfig, estimate]);

  // Optimistic at once, authoritative after a pause; the last good figure stays while it refreshes (§39, §53, §54).
  React.useEffect(() => {
    if (!hydrated) return;
    const optimistic = estimate(input);
    setQuote(optimistic);
    setError(null);
    window.history.replaceState({ pricingStep: stepRef.current }, "", urlFor(input, stepRef.current));
    if (stepRef.current === REVIEW) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setUpdating(true);
      try {
        const official = await postJson<PricingQuote>("/api/public/pricing/calculate", { configuration: input, persistQuote: false });
        if (!controller.signal.aborted && stepRef.current !== REVIEW) { lastGood.current = official; setQuote(official); }
      } catch {
        if (!controller.signal.aborted && stepRef.current !== REVIEW) { setQuote(lastGood.current); setError(t.estimate.failed); }
      } finally {
        if (!controller.signal.aborted) setUpdating(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [hydrated, input, estimate, t]);

  const fingerprint = React.useMemo(() => JSON.stringify({ ...input, rozarisProjects: input.rozarisProjects?.map((project) => project.type) }), [input]);
  // The Review step saves the quote with its price version, for the proposal to reference (§44, §51).
  React.useEffect(() => {
    if (!hydrated || step !== REVIEW || savedFor === fingerprint) return;
    if (input.foundation === "ROZARIS" && !hasRozarisProjects(input)) return;
    let active = true;
    setUpdating(true);
    postJson<PricingQuote>("/api/public/pricing/calculate", { configuration: input, persistQuote: true })
      .then((saved) => { if (!active) return; lastGood.current = saved; setQuote(saved); setSavedFor(fingerprint); setError(null); })
      .catch(() => active && setError(t.estimate.failed))
      .finally(() => active && setUpdating(false));
    return () => { active = false; };
  }, [fingerprint, hydrated, input, savedFor, step, t]);

  function change(next: PricingRequest, event?: string, extra?: Record<string, unknown>) {
    setInput(next);
    setSavedFor(null);
    if (event) track(event, next, extra);
  }

  function chooseFoundation(foundation: Foundation) {
    if (foundation === input.foundation) return;
    const base = defaultRequest(foundation, initialConfig);
    const offered = new Set(initialConfig.modules.filter((row) => isOffered(row, foundation) && !isIncluded(row, foundation)).map((row) => row.id));
    const kept = input.modules.filter((id) => offered.has(id));
    const next = withPromotion(initialConfig, {
      ...base,
      modules: kept,
      contractMonths: input.contractMonths,
      rozarisProjects: foundation === "ROZARIS" ? (input.rozarisProjects?.length ? input.rozarisProjects : base.rozarisProjects) : input.rozarisProjects,
      companies: initialConfig.companies[foundation].additionalAvailable ? input.companies : base.companies,
    });
    // Only incompatible choices go, and the visitor is told (§36).
    const lost = input.modules.length - kept.length;
    const sales = initialConfig.modules.find((row) => row.id === "SALES");
    setNotice(foundation === "ROZARIS" && sales && isIncluded(sales, "ROZARIS") ? `${t.estimate.updated} ${fill(t.modules.includedWith, { foundation: "ROZARIS" })}: ${sales.name}.` : lost ? t.estimate.updated : null);
    change(next, "pricing_foundation_selected");
  }

  function move(target: number) {
    const next = bounded(target, 0, STEPS.length - 1);
    if (next > step && !stepValid(step)) return;
    setStep(next);
    setReached((value) => Math.max(value, next));
    window.history.pushState({ pricingStep: next }, "", urlFor(input, next));
    document.getElementById("pricing-step-heading")?.focus({ preventScroll: true });
    document.getElementById("configurator")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (next === REVIEW) track("pricing_review_viewed", input);
  }

  function stepValid(index: number) {
    if (STEPS[index] === "projects" && input.foundation === "ROZARIS") return hasRozarisProjects(input);
    return true;
  }

  const ctx: Ctx = { config: initialConfig, book, input, quote, t, money, change };
  const name = STEPS[step];
  const blocked = input.foundation === "ROZARIS" && !hasRozarisProjects(input);

  return (
    <div>
      <nav aria-label={t.eyebrow} className="-mx-1 overflow-x-auto px-1 pb-1">
        <ol className="flex min-w-[720px] gap-1.5">
          {STEPS.map((key, index) => {
            const done = index < step || (index <= reached && index !== step);
            const future = index > reached;
            return (
              <li key={key} className="min-w-0 flex-1">
                <button type="button" onClick={() => move(index)} disabled={future && index > step + 1} aria-current={index === step ? "step" : undefined} className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-table font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", index === step ? "border-accent bg-accent-soft text-accent-strong" : done ? "border-line bg-surface text-fg hover:bg-hover" : "border-line bg-canvas text-fg-subtle")}>
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-micro", index === step ? "bg-accent text-accent-fg" : done ? "bg-success-soft text-success-strong" : "bg-hover text-fg-subtle")}>{done && index !== step ? <Check className="size-3" aria-hidden="true" /> : index + 1}</span>
                  <span className="truncate">{t.steps[key]}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-labelledby="pricing-step-heading">
          <div className="border-b border-line px-5 py-5 sm:px-7">
            <p className="nesto-eyebrow text-accent-strong">{fill(t.stepOf, { n: step + 1, total: STEPS.length })} · {t.steps[name]}</p>
            <h2 id="pricing-step-heading" tabIndex={-1} className="mt-2 text-page font-semibold text-fg outline-none">{t.headings[name]}</h2>
            <p className="mt-1.5 max-w-3xl text-body leading-relaxed text-fg-muted">{name === "projects" ? (input.foundation === "ROZARIS" ? t.descriptions.projectsRozaris : t.descriptions.projectsNesto) : t.descriptions[name]}</p>
            {notice ? <p role="status" className="mt-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-table text-fg">{notice}</p> : null}
          </div>
          <div className="p-5 sm:p-7">
            {name === "foundation" ? <FoundationStep ctx={ctx} choose={chooseFoundation} /> : null}
            {name === "modules" ? <ModulesStep ctx={ctx} /> : null}
            {name === "companies" ? <CompaniesStep ctx={ctx} /> : null}
            {name === "projects" ? <ProjectsStep ctx={ctx} /> : null}
            {name === "users" ? <UsersStep ctx={ctx} /> : null}
            {name === "contract" ? <ContractStep ctx={ctx} /> : null}
            {name === "review" ? <ReviewStep ctx={ctx} updating={updating} blocked={blocked} onProposal={(type) => { setProposal(type); track("pricing_proposal_started", input, { requestType: type }); }} /> : null}
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-7">
            <Button type="button" variant="secondary" size="lg" onClick={() => move(step - 1)} disabled={step === 0}><ArrowLeft aria-hidden="true" /> {t.back}</Button>
            {step < REVIEW ? <Button type="button" size="lg" onClick={() => move(step + 1)} disabled={!stepValid(step)}>{t.continue} <ArrowRight aria-hidden="true" /></Button> : <Button type="button" variant="secondary" size="lg" onClick={() => move(0)}>{t.startOver}</Button>}
          </footer>
        </section>

        <Estimate ctx={ctx} updating={updating} error={error} step={step} />
      </div>

      {/* A compact price on small screens, below the form, never over it (§47). */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-5 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur xl:hidden">
        <p className="text-card font-semibold text-fg" aria-hidden="true">{money(quote.standardMonthlyCents)} <span className="text-meta font-normal text-fg-muted">{t.estimate.perMonth}</span></p>
        <a href="#pricing-estimate" className="inline-flex min-h-11 items-center text-table font-medium text-accent-strong">{t.estimate.viewBreakdown}</a>
      </div>

      <ProposalDialog open={proposal !== null} type={proposal ?? "FORMAL_PROPOSAL"} quote={quote} t={t} money={money} onOpenChange={(open) => !open && setProposal(null)} />
    </div>
  );
}

/* ---------------------------------------------------------------- steps -- */

function FoundationStep({ ctx, choose }: { ctx: Ctx; choose: (foundation: Foundation) => void }) {
  const { config, input, t, money } = ctx;
  const lowest = Math.min(...CLASSES.map((type) => config.rozaris.classes[type].monthly24Cents));
  const order: Foundation[] = ["ROZARIS", "NESTO_PLATFORM"];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {order.map((id) => {
        const foundation = config.foundations.find((row) => row.id === id);
        if (!foundation) return null;
        const words = t.foundationText[id];
        const selected = input.foundation === id;
        return (
          <button key={id} type="button" onClick={() => choose(id)} aria-pressed={selected} data-testid={`foundation-${id.toLowerCase()}`} className={cn("flex w-full flex-col overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected ? "border-accent ring-2 ring-accent/15" : "border-line hover:border-line-strong")}>
            <Preview kind={id === "ROZARIS" ? "rozaris" : "platform"} label={words?.name ?? foundation.name} />
            <span className="flex flex-1 flex-col p-5">
              <span className="flex items-center justify-between gap-2"><strong className="text-card text-fg">{words?.name ?? foundation.name}</strong><span className={cn("text-meta font-semibold", selected ? "text-accent-strong" : "text-fg-subtle")}>{selected ? <><CheckCircle2 className="mr-1 inline size-4" aria-hidden="true" />{t.foundation.selected}</> : t.foundation.choose}</span></span>
              <span className="mt-1 text-table font-semibold text-fg">{id === "ROZARIS" ? fill(t.foundation.fromProject, { price: money(lowest) }) : fill(t.foundation.from, { price: money(foundation.baseMonthlyCents) })}</span>
              <span className="mt-2 text-table leading-relaxed text-fg-muted">{words?.description ?? foundation.description}</span>
              <span className="mt-3 flex flex-wrap gap-x-4 gap-y-1">{(words?.included ?? foundation.included).map((item) => <span key={item} className="inline-flex items-center gap-1.5 text-meta text-fg-muted"><Check className="size-3.5 text-success-strong" aria-hidden="true" />{item}</span>)}</span>
              <span className="mt-3 text-meta text-fg-subtle">{id === "ROZARIS" ? t.foundation.rozarisNote : t.foundation.platformNote}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ModulesStep({ ctx }: { ctx: Ctx }) {
  const { config, book, input, t, change } = ctx;
  const resolved = React.useMemo(() => resolveModules(book, input.foundation, input.modules).rows, [book, input.foundation, input.modules]);
  const held = new Map(resolved.map((row) => [row.id, row]));
  const shown = config.modules.filter((row) => isOffered(row, input.foundation)).sort((a, b) => a.sortOrder - b.sortOrder);
  const absorbedBy = (row: PricingModule) => config.modules.find((other) => held.has(other.id) && other.absorbs.includes(row.id));
  if (shown.length === 0) return <p className="text-body text-fg-muted">{t.modules.none}</p>;
  function toggle(row: PricingModule) {
    const on = input.modules.includes(row.id);
    change({ ...input, modules: on ? input.modules.filter((id) => id !== row.id) : [...input.modules, row.id] }, on ? "pricing_module_removed" : "pricing_module_selected", { moduleId: row.id });
  }
  return (
    <div className="space-y-6">
      {MODULE_GROUPS.map((group) => {
        const rows = shown.filter((row) => row.group === group);
        if (rows.length === 0) return null;
        return (
          <fieldset key={group}>
            <legend className="nesto-eyebrow text-fg-subtle">{t.groups[group] ?? group}</legend>
            <div className="mt-2 grid gap-3 md:grid-cols-2">{rows.map((row) => <ModuleCard key={row.id} row={row} ctx={ctx} held={held.get(row.id)} absorbedBy={absorbedBy(row)} onToggle={() => toggle(row)} />)}</div>
          </fieldset>
        );
      })}
    </div>
  );
}

function ModuleCard({ row, ctx, held, absorbedBy, onToggle }: { row: PricingModule; ctx: Ctx; held?: { included: boolean; locked: boolean; reason: string }; absorbedBy?: PricingModule; onToggle: () => void }) {
  const { input, t, money, config } = ctx;
  const [open, setOpen] = React.useState(false);
  const words = t.moduleText[row.id];
  const included = isIncluded(row, input.foundation);
  const foundationName = t.foundationText[input.foundation]?.name ?? config.foundations.find((item) => item.id === input.foundation)?.name ?? "";
  const selected = Boolean(held) || Boolean(absorbedBy);
  const state = included ? fill(t.modules.includedWith, { foundation: foundationName }) : absorbedBy ? fill(t.modules.absorbed, { name: t.moduleText[absorbedBy.id]?.name ?? absorbedBy.name }) : fill(t.modules.addOn, { price: money(row.monthlyPriceCents) });
  return (
    <article className={cn("flex flex-col rounded-xl border p-4", selected ? "border-accent/60 bg-accent-soft/30" : "border-line")} data-testid={`module-${row.id.toLowerCase()}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-card font-semibold text-fg">{words?.name ?? row.name}</h3>
          <p className="mt-0.5 text-table text-fg-muted">{words?.short ?? row.shortDescription}</p>
        </div>
        <Preview kind="module" label={words?.name ?? row.name} small />
      </div>
      <p className="mt-2 text-table font-semibold text-fg">{state}</p>
      {open ? <p className="mt-2 text-table leading-relaxed text-fg-muted">{words?.description ?? row.description}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="min-h-11 text-table font-medium text-accent-strong hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t.modules.showLess : t.modules.learnMore}</button>
        {included && row.lockedWhenIncluded ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-success/30 bg-success-soft px-3 text-table font-medium text-success-strong"><Lock className="size-3.5" aria-hidden="true" />{t.modules.included}</span>
        ) : included || absorbedBy ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 px-1 text-table font-medium text-success-strong"><Check className="size-4" aria-hidden="true" />{t.modules.included}</span>
        ) : (
          <Button type="button" size="sm" className="min-h-11" variant={held ? "secondary" : "primary"} aria-pressed={Boolean(held)} onClick={onToggle}>{held ? t.modules.remove : t.modules.add}</Button>
        )}
      </div>
    </article>
  );
}

function CompaniesStep({ ctx }: { ctx: Ctx }) {
  const { config, input, t, money, change } = ctx;
  const rules = config.companies[input.foundation];
  const set = (key: keyof PricingRequest["companies"], value: number) => change({ ...input, companies: { ...input.companies, [key]: value } }, "pricing_company_changed");
  return (
    <div className="space-y-3">
      <Included icon={<Building2 />} title={fill(rules.included === 1 ? t.companies.included : t.companies.includedPlural, { n: rules.included })} />
      {rules.additionalAvailable ? (
        <>
          <Stepper label={t.companies.operating} help={fill(t.companies.operatingHelp, { price: money(rules.fullGroupMonthlyCents), users: rules.includedUsersPerFullCompany })} value={input.companies.fullGroup} max={500} onChange={(value) => set("fullGroup", value)} />
          <Stepper label={t.companies.jv} help={fill(t.companies.jvHelp, { price: money(rules.jointVentureMonthlyCents), users: rules.includedUsersPerFullCompany })} value={input.companies.jointVenture} max={500} onChange={(value) => set("jointVenture", value)} />
          <Stepper label={t.companies.documents} help={fill(t.companies.documentsHelp, { price: money(rules.documentsOnlyMonthlyCents) })} value={input.companies.documentsOnly} max={500} onChange={(value) => set("documentsOnly", value)} />
        </>
      ) : <p className="rounded-xl border border-line bg-canvas p-4 text-table text-fg-muted">{t.companies.onRequest}</p>}
      <p className="text-meta text-fg-subtle">{t.companies.external}</p>
    </div>
  );
}

function ProjectsStep({ ctx }: { ctx: Ctx }) {
  const { config, input, t, money, change } = ctx;
  const projects = input.rozarisProjects ?? [];
  const term = input.contractMonths === 24 ? "monthly24Cents" : "monthly12Cents";
  const setProjects = (next: NonNullable<PricingRequest["rozarisProjects"]>, event: string) => change({ ...input, rozarisProjects: next }, event);
  return (
    <div className="space-y-4">
      {input.nestoProjects ? (
        <>
          <Stepper label={t.projects.nestoActive} help={fill(t.projects.nestoHelp, { included: config.nestoProjects.included, price: money(config.nestoProjects.additionalMonthlyCents) })} value={input.nestoProjects.active} min={1} max={1_000} onChange={(active) => change({ ...input, nestoProjects: { active } }, "pricing_project_added")} />
          <h3 className="pt-2 text-card font-semibold text-fg">{t.projects.rozarisOptional}</h3>
        </>
      ) : null}
      {projects.map((project, index) => (
        <fieldset key={project.tempId} className="rounded-xl border border-line p-4" data-testid="rozaris-project">
          <div className="flex items-center justify-between gap-2">
            <legend className="text-card font-semibold text-fg">{fill(t.projects.project, { n: index + 1 })}</legend>
            {projects.length > 1 || input.foundation !== "ROZARIS" ? <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={() => setProjects(projects.filter((row) => row.tempId !== project.tempId), "pricing_project_type_changed")} aria-label={`${t.projects.remove} ${index + 1}`}><Trash2 className="size-4" aria-hidden="true" /></Button> : null}
          </div>
          <div role="radiogroup" aria-label={t.projects.type} className="mt-3 grid gap-2 sm:grid-cols-3">
            {CLASSES.map((type) => {
              const rate = config.rozaris.classes[type];
              const words = t.classes[type];
              const on = project.type === type;
              return (
                <button key={type} type="button" role="radio" aria-checked={on} onClick={() => setProjects(projects.map((row) => row.tempId === project.tempId ? { ...row, type } : row), "pricing_project_type_changed")} className={cn("flex min-h-11 flex-col rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong")}>
                  <Preview kind={type.toLowerCase() as "basic" | "large" | "village"} label={words?.name ?? rate.name} small />
                  <span className="mt-2 text-table font-semibold text-fg">{words?.name ?? rate.name}</span>
                  <span className="text-table text-fg">{fill(t.projects.perMonth, { price: money(rate[term]) })}</span>
                  <span className="text-meta text-fg-muted">{fill(t.projects.users, { n: rate.includedUsers })}</span>
                  <span className="mt-1 text-meta leading-snug text-fg-subtle">{words?.guidance ?? rate.guidance}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      <Button type="button" variant="secondary" className="min-h-11" onClick={() => setProjects([...projects, { tempId: newProjectId(), type: "BASIC" }], "pricing_project_added")}>{projects.length ? t.projects.add : t.projects.addFirst}</Button>
      {input.foundation === "ROZARIS" && projects.length === 0 ? <p role="alert" className="text-table text-danger-strong">{t.projects.atLeastOne}</p> : null}
      {projects.length ? <div className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-table"><p className="font-semibold text-warning-strong">{t.projects.production}</p><p className="mt-1 text-fg-muted">{t.projects.review}</p></div> : null}
    </div>
  );
}

function UsersStep({ ctx }: { ctx: Ctx }) {
  const { input, quote, t, money, change } = ctx;
  const users = quote.users;
  return (
    <div className="space-y-4">
      <Stepper label={t.users.requested} help={t.users.requestedHelp} value={input.activeUsers} min={1} max={100_000} onChange={(activeUsers) => change({ ...input, activeUsers }, "pricing_users_changed")} />
      <dl className="grid gap-4 rounded-xl border border-line bg-canvas p-5 sm:grid-cols-2" data-testid="users-calculation">
        <Stat label={t.users.included} value={String(users.included)} />
        <Stat label={t.users.additional} value={String(users.billable)} />
        <Stat label={t.users.packs} value={users.packs ? fill(t.users.packsValue, { packs: users.packs, size: users.packSize }) : "—"} />
        <Stat label={t.users.price} value={users.monthlyCents ? `${money(users.monthlyCents)} ${t.estimate.perMonth}` : "—"} />
      </dl>
      {users.billable === 0 ? <p className="text-table text-fg-muted">{t.users.covered}</p> : null}
      <Included icon={<Users />} title={t.users.requestedHelp} />
    </div>
  );
}

function ContractStep({ ctx }: { ctx: Ctx }) {
  const { config, input, quote, t, change } = ctx;
  const choose = (contractMonths: 12 | 24) => change(withPromotion(config, { ...input, contractMonths }), "pricing_contract_changed");
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label={t.steps.contract} className="grid gap-3 sm:grid-cols-2">
        {([24, 12] as const).map((months) => {
          const offer = promotionFor(config, input.foundation, months);
          const on = input.contractMonths === months;
          return (
            <button key={months} type="button" role="radio" aria-checked={on} onClick={() => choose(months)} className={cn("min-h-11 rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong")}>
              <span className="flex items-center justify-between"><strong className="text-card text-fg">{fill(t.contract.months, { n: months })}</strong>{months === 24 ? <span className="text-meta text-accent-strong">{t.contract.default}</span> : null}</span>
              <span className="mt-1 block text-table text-fg-muted">{offer ? `${t.contract.offer}: ${t.contract.offerText}` : t.contract.standard}</span>
            </button>
          );
        })}
      </div>
      {quote.indexation.enabled ? (
        <div className="rounded-xl border border-line bg-canvas p-4">
          <p className="text-table font-semibold text-fg">{t.contract.hicpTitle}</p>
          <p className="mt-1 text-table leading-relaxed text-fg-muted">{fill(t.contract.hicp, { floor: quote.indexation.floorPercent, cap: quote.indexation.capPercent })}</p>
          <p className="mt-2 text-meta text-fg-subtle">{t.contract.hicpNote}</p>
        </div>
      ) : null}
    </div>
  );
}

function ReviewStep({ ctx, updating, blocked, onProposal }: { ctx: Ctx; updating: boolean; blocked: boolean; onProposal: (type: ProposalType) => void }) {
  const { config, input, quote, t, money } = ctx;
  const foundationName = t.foundationText[quote.foundation.id]?.name ?? quote.foundation.label;
  const included = quote.modules.filter((row) => row.included);
  const added = quote.modules.filter((row) => !row.included);
  const moduleName = (row: { id: string; name: string }) => t.moduleText[row.id]?.name ?? row.name;
  const rows: Array<[string, React.ReactNode, number | null]> = [
    [t.review.foundation, foundationName, quote.foundation.monthlyCents || null],
    ...(included.length ? [[t.review.included, included.map(moduleName).join(", "), null] as [string, React.ReactNode, null]] : []),
    ...added.map((row) => [t.review.added, moduleName(row), row.monthlyCents] as [string, React.ReactNode, number]),
    ...(quote.companies.monthlyCents || quote.companies.fullGroup + quote.companies.jointVenture + quote.companies.documentsOnly ? [[t.review.companies, `${quote.companies.included} + ${quote.companies.fullGroup + quote.companies.jointVenture + quote.companies.documentsOnly}`, quote.companies.monthlyCents] as [string, React.ReactNode, number]] : [[t.review.companies, String(quote.companies.included), null] as [string, React.ReactNode, null]]),
    ...quote.projects.map((project) => [t.review.projects, project.type === "NESTO" ? project.label : `${t.classes[project.type]?.name ?? config.rozaris.classes[project.type as RozarisClass]?.name ?? project.type} · ROZARIS`, project.monthlyCents || null] as [string, React.ReactNode, number | null]),
    [t.review.users, fill(t.review.usersLine, { included: quote.users.included, billable: quote.users.billable }), quote.users.monthlyCents || null],
    [t.review.contract, fill(t.contract.months, { n: quote.contractMonths }), null],
  ];
  return (
    <div className="space-y-5">
      <dl className="divide-y divide-line rounded-xl border border-line" data-testid="review-breakdown">
        {rows.map(([label, value, cents], index) => (
          <div key={`${label}-${index}`} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-3 text-table">
            <dt className="nesto-eyebrow text-fg-subtle">{label}</dt>
            <dd className="text-fg">{value}</dd>
            <dd className="text-right font-semibold text-fg">{cents === null ? "" : `+ ${money(cents)}`}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 bg-canvas px-4 py-4"><dt className="text-table font-semibold uppercase tracking-wide text-fg">{t.review.standard}</dt><dd className="text-section font-semibold text-fg">{money(quote.standardMonthlyCents)}</dd></div>
      </dl>
      {quote.schedule.length > 1 ? (
        <div>
          <h3 className="text-card font-semibold text-fg">{t.review.timeline}</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">{quote.schedule.map((period) => <div key={period.fromMonth} className="rounded-xl border border-line bg-canvas p-4"><p className="nesto-eyebrow text-fg-subtle">{period.fromMonth === period.toMonth ? `${t.review.month} ${period.fromMonth}` : fill(t.review.monthsRange, { from: period.fromMonth, to: period.toMonth })}</p><p className="mt-2 text-section font-semibold text-fg">{money(period.monthlyCents)}<span className="text-meta font-normal text-fg-muted"> {t.estimate.perMonth}</span></p></div>)}</div>
        </div>
      ) : null}
      <div className="rounded-xl bg-graphite p-5 text-graphite-fg">
        <p className="nesto-eyebrow text-graphite-fg/60">{t.review.contractValue}</p>
        <p className="mt-2 font-serif text-display">{money(quote.preIndexationContractValueCents)}</p>
        <p className="mt-1 text-table text-graphite-fg/70">{t.contract.hicpNote}</p>
        {quote.quoteReference ? <p className="mt-3 font-mono text-table">{fill(t.review.reference, { ref: quote.quoteReference })}</p> : updating ? <p className="mt-3 text-table text-graphite-fg/70">{t.review.saving}</p> : null}
      </div>
      {blocked ? <p role="alert" className="rounded-lg bg-warning-soft p-3 text-table text-warning-strong">{t.review.needProject}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" size="lg" disabled={blocked || updating || !quote.quoteId} onClick={() => onProposal("FORMAL_PROPOSAL")}>{t.review.proposal}</Button>
        <Button type="button" size="lg" variant="secondary" disabled={blocked || updating || !quote.quoteId} onClick={() => onProposal("TALK_TO_SALES")}>{t.review.talk}</Button>
        {hasRozarisProjects(input) ? <Button type="button" size="lg" variant="secondary" disabled={updating || !quote.quoteId} onClick={() => onProposal("THREE_D_PRODUCTION")}>{t.review.production}</Button> : null}
      </div>
      <div>
        <p className="text-table font-semibold text-fg">{t.review.exclusions}</p>
        <ul className="mt-1 grid gap-1 text-meta text-fg-subtle sm:grid-cols-2">{quote.exclusions.map((item) => <li key={item} className="flex gap-2"><span aria-hidden="true">—</span>{item}</li>)}</ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- estimate -- */

/** The live estimate: the figure with its context, only rows that apply (§31-§33). Never "Confirmed". */
function Estimate({ ctx, updating, error, step }: { ctx: Ctx; updating: boolean; error: string | null; step: number }) {
  const { quote, t, money, config } = ctx;
  const foundationName = t.foundationText[quote.foundation.id]?.name ?? quote.foundation.label;
  const added = quote.modules.filter((row) => !row.included);
  const rozaris = quote.projects.filter((project) => project.type !== "NESTO");
  const rows: Array<[string, string]> = [[t.estimate.foundation, rozaris.length && quote.foundation.id === "ROZARIS" ? `${foundationName} · ${rozaris.map((project) => t.classes[project.type]?.name ?? config.rozaris.classes[project.type as RozarisClass]?.name).join(", ")}` : foundationName]];
  if (step >= 1) rows.push([t.estimate.modules, [fill(t.estimate.modulesIncluded, { n: quote.modules.filter((row) => row.included).length }), added.length ? fill(t.estimate.modulesAdded, { n: added.length }) : ""].filter(Boolean).join(" · ")]);
  if (step >= 2) rows.push([t.estimate.companies, String(quote.companies.included + quote.companies.fullGroup + quote.companies.jointVenture) + (quote.companies.documentsOnly ? ` + ${quote.companies.documentsOnly}` : "")]);
  if (step >= 3 && quote.projects.length) rows.push([t.estimate.projects, quote.projects.map((project) => project.type === "NESTO" ? project.label : t.classes[project.type]?.name ?? project.type).join(" · ")]);
  if (step >= 4) rows.push([t.estimate.users, `${quote.users.requested} (${quote.users.included} ${t.users.included.toLowerCase()})`]);
  if (step >= 5) rows.push([t.estimate.contract, fill(t.contract.months, { n: quote.contractMonths })]);
  if (step >= 5 && quote.promotion.applied) rows.push([t.estimate.promotion, quote.schedule.filter((period) => period.discountPercent).map((period) => fill(t.review.monthsRange, { from: period.fromMonth, to: period.toMonth }) + ` −${period.discountPercent}%`).join(" · ")]);
  return (
    <aside id="pricing-estimate" className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-surface shadow-card xl:sticky xl:top-24" aria-label={t.estimate.label}>
      <div className="bg-graphite p-6 text-graphite-fg">
        <div className="flex items-center justify-between">
          <p className="nesto-eyebrow text-graphite-fg/60">{t.estimate.label}</p>
          {updating ? <span className="inline-flex items-center gap-1.5 text-meta text-graphite-fg/70"><RefreshCw className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> {t.estimate.updating}</span> : null}
        </div>
        <p className="mt-3 font-serif text-display" aria-live="polite" data-testid="estimate-monthly">{money(quote.standardMonthlyCents)}<span className="text-table font-normal text-graphite-fg/70"> {t.estimate.perMonth}</span></p>
        <p className="mt-1 text-table text-graphite-fg/70">{t.estimate.standard}</p>
      </div>
      <dl className="divide-y divide-line px-5">{rows.map(([label, value]) => <div key={label} className="flex items-start justify-between gap-3 py-2.5 text-table"><dt className="text-fg-muted">{label}</dt><dd className="text-right font-medium text-fg">{value}</dd></div>)}</dl>
      {step >= 5 ? (
        <div className="border-t border-line bg-canvas p-5">
          <p className="text-meta uppercase tracking-wide text-fg-subtle">{t.estimate.contractValue}</p>
          <p className="mt-1 text-section font-semibold text-fg">{money(quote.preIndexationContractValueCents)}</p>
          <p className="mt-1 text-meta text-fg-subtle">{t.estimate.beforeHicp}</p>
        </div>
      ) : null}
      {quote.notices.length ? <ul className="border-t border-line px-5 py-3 text-meta text-fg-muted">{quote.notices.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      {error ? <p role="alert" className="m-4 rounded-md bg-danger-soft p-2 text-meta text-danger-strong">{error}</p> : null}
    </aside>
  );
}

/* -------------------------------------------------------------- visuals -- */

/**
 * A light product illustration standing where a screenshot goes (§8, §16, §46):
 * shaped like the screen it stands for, no live 3D, no network request. A
 * real screenshot replaces it by its price-book `imageKey`.
 */
function Preview({ kind, label, small = false }: { kind: "rozaris" | "platform" | "module" | "basic" | "large" | "village"; label: string; small?: boolean }) {
  const blocks = kind === "basic" ? 1 : kind === "large" ? 3 : kind === "village" ? 7 : 0;
  if (small && kind === "module") return <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-strong"><Layers3 className="size-5" /></span>;
  if (small) {
    return (
      <span role="img" aria-label={label} className="flex h-14 items-end gap-1 rounded-md bg-canvas p-2 [background-image:linear-gradient(to_right,var(--nesto-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--nesto-border)_1px,transparent_1px)] [background-size:12px_12px]">
        {Array.from({ length: blocks }, (_, index) => <span key={index} className="w-3 rounded-sm bg-accent/70" style={{ height: `${40 + ((index * 37) % 50)}%` }} />)}
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} className="relative block h-36 overflow-hidden border-b border-line bg-canvas [background-image:linear-gradient(to_right,var(--nesto-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--nesto-border)_1px,transparent_1px)] [background-size:24px_24px]">
      {kind === "rozaris" ? (
        <>
          <span className="absolute inset-y-4 left-4 w-[58%] rounded-lg border border-line bg-surface/80 p-3"><Orbit className="size-5 text-accent-strong" aria-hidden="true" /><span className="mt-6 flex items-end gap-1.5">{[60, 85, 45, 70].map((height, index) => <span key={index} className="w-5 rounded-sm bg-accent/60" style={{ height }} />)}</span></span>
          <span className="absolute inset-y-4 right-4 w-[32%] space-y-1.5 rounded-lg border border-line bg-surface p-2">{["bg-success", "bg-warning", "bg-success", "bg-danger"].map((tone, index) => <span key={index} className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", tone)} /><span className="h-1.5 flex-1 rounded bg-hover" /></span>)}</span>
        </>
      ) : (
        <>
          <span className="absolute inset-y-4 left-4 w-[22%] space-y-1.5 rounded-lg border border-line bg-surface p-2">{Array.from({ length: 6 }, (_, index) => <span key={index} className={cn("block h-1.5 rounded", index === 1 ? "bg-accent" : "bg-hover")} />)}</span>
          <span className="absolute inset-y-4 left-[30%] right-4 grid grid-cols-3 gap-2 rounded-lg border border-line bg-surface p-2">{Array.from({ length: 6 }, (_, index) => <span key={index} className="rounded bg-canvas" />)}</span>
        </>
      )}
    </span>
  );
}

/* --------------------------------------------------------------- pieces -- */

function Stepper({ label, value, onChange, help, min = 0, max }: { label: string; value: number; onChange: (value: number) => void; help: string; min?: number; max: number }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><label htmlFor={id} className="text-card font-semibold text-fg">{label}</label><p className="mt-0.5 text-table text-fg-muted">{help}</p></div>
      <div className="flex items-center" role="group" aria-label={label}>
        <Button type="button" variant="secondary" size="icon" className="size-11 rounded-r-none" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`− ${label}`}><Minus aria-hidden="true" /></Button>
        <Input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(event) => onChange(bounded(event.target.valueAsNumber, min, max))} className="h-11 w-24 rounded-none border-x-0 text-center text-card font-semibold" />
        <Button type="button" variant="secondary" size="icon" className="size-11 rounded-l-none" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`+ ${label}`}><Plus aria-hidden="true" /></Button>
      </div>
    </div>
  );
}

function Included({ icon, title }: { icon: React.ReactNode; title: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft p-3.5"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-success-strong [&_svg]:size-5" aria-hidden="true">{icon}</span><p className="text-table font-semibold text-fg">{title}</p></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-meta text-fg-subtle">{label}</dt><dd className="mt-1 text-section font-semibold text-fg">{value}</dd></div>;
}

function ProposalDialog({ open, type, quote, t, money, onOpenChange }: { open: boolean; type: ProposalType; quote: PricingQuote; t: PricingCopy; money: (cents: number) => string; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = React.useState({ fullName: "", companyName: "", businessEmail: "", phone: "", message: "", consent: false, website: "" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reference, setReference] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setError(null); setReference(null); } }, [open, type]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!quote.quoteId) return setError(t.proposal.wait);
    setPending(true);
    setError(null);
    try {
      const result = await postJson<{ reference: string }>("/api/public/pricing/lead", { quoteId: quote.quoteId, requestType: type, ...form });
      setReference(result.reference);
      track("pricing_proposal_submitted", quote.normalizedConfiguration, { requestType: type });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message || t.proposal.failed : t.estimate.failed);
    } finally {
      setPending(false);
    }
  }
  const field = (label: string, node: React.ReactNode, required = false) => <label className="block text-meta font-medium text-fg-muted">{label}{required ? <span className="text-danger-strong"> *</span> : null}<span className="mt-1.5 block">{node}</span></label>;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{reference ? t.proposal.savedTitle : t.proposal[type]}</DialogTitle>
        <DialogDescription>{reference ? t.proposal.savedBody : fill(t.proposal.intro, { months: quote.contractMonths, value: money(quote.preIndexationContractValueCents) })}</DialogDescription>
        {reference ? (
          <div className="mt-6 rounded-xl border border-success/30 bg-success-soft p-5 text-center"><p className="text-table text-fg-muted">{t.proposal.yourReference}</p><p className="mt-1 font-mono text-section font-semibold text-fg">{reference}</p><Button type="button" className="mt-5" onClick={() => onOpenChange(false)}>{t.proposal.done}</Button></div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {field(t.proposal.fullName, <Input required maxLength={160} autoComplete="name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />, true)}
              {field(t.proposal.company, <Input required maxLength={200} autoComplete="organization" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} />, true)}
              {field(t.proposal.email, <Input required type="email" maxLength={254} autoComplete="email" value={form.businessEmail} onChange={(event) => setForm({ ...form, businessEmail: event.target.value })} />, true)}
              {field(t.proposal.phone, <Input type="tel" maxLength={60} autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />)}
            </div>
            {field(t.proposal.message, <Textarea maxLength={2_000} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />)}
            <div className="hidden" aria-hidden="true"><label>Website<Input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} /></label></div>
            <label className="flex cursor-pointer items-start gap-3 text-table text-fg-muted"><input type="checkbox" required checked={form.consent} onChange={(event) => setForm({ ...form, consent: event.target.checked })} className="mt-0.5 size-4 rounded border-line-strong" /><span>{t.proposal.consent}</span></label>
            {error ? <p role="alert" className="rounded-md bg-danger-soft p-3 text-table text-danger-strong">{error}</p> : null}
            <DialogFooter><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>{t.proposal.cancel}</Button><Button type="submit" disabled={pending || !form.consent}>{pending ? t.proposal.submitting : t.proposal.submit}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
