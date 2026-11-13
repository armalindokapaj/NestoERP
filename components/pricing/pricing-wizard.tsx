"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Layers3, Lock, Minus, Orbit, Plus, RefreshCw, Users } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { numberText } from "@/lib/i18n/format";
import { engineBook } from "@/lib/marketing/price-book";
import { fill, type PricingCopy } from "@/lib/i18n/site/pricing-configurator";
import { defaultRequest, MODULE_GROUPS } from "@/lib/modules/pricing/pricing.config";
import { calculatePricing, hasRozarisProjects, isOffered, offersGroup, resolveModules } from "@/lib/modules/pricing/pricing.engine";
import type { CustomerType, ModuleReason, PricingConfig, PricingModule, PricingQuote, PricingRequest, PublicPricingConfig, RozarisClass } from "@/lib/modules/pricing/pricing.types";
import { cn } from "@/lib/utils/cn";

/*
 * The public pricing configurator (docs/pricing-modules.md). The page is the
 * configurator: what the buyer is (a company or a group of companies), its
 * projects, ROZARIS 3D, modules, users and contract, with the live estimate
 * beside them and the address carrying the configuration. The browser
 * estimates with the same engine; the server's answer replaces it.
 */

const STEPS = ["type", "projects", "rozaris", "modules", "users", "contract", "review"] as const;
type Step = (typeof STEPS)[number];
const REVIEW = STEPS.indexOf("review");
const CLASSES: RozarisClass[] = ["BASIC", "LARGE", "VILLAGE"];
type ProposalType = "FORMAL_PROPOSAL" | "TALK_TO_SALES" | "THREE_D_PRODUCTION";
/** Old addresses' step names, read once and rewritten. */
const OLD_STEPS: Record<string, Step> = { foundation: "type", product: "type", companies: "type" };

function promotionFor(config: PublicPricingConfig, months: 12 | 24, requested?: string | null) {
  const eligible = config.promotions.filter((row) => row.enabled && row.product === "NESTO_PLATFORM" && row.requiredContractMonths === months);
  return eligible.find((row) => row.code === requested) ?? eligible[0] ?? null;
}

const bounded = (value: number, min: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min);
let projectSeq = 0;
const newProjectId = () => `p${Date.now().toString(36)}${(projectSeq++).toString(36)}`;

function withPromotion(config: PublicPricingConfig, input: PricingRequest, requested?: string | null): PricingRequest {
  return { ...input, promotionCode: promotionFor(config, input.contractMonths, requested ?? input.promotionCode)?.code ?? null };
}

const minUsers = (config: PublicPricingConfig, customer: CustomerType) => (customer === "GROUP" ? config.customers.group.minUsers : config.customers.company.minUsers);

/**
 * The address → a configuration. Old links (`foundation=`, `mode=`, the old
 * step names, per-class ROZARIS counts) are read and rewritten in the new form;
 * an old ROZARIS link becomes a company with its 3D projects.
 */
function readUrl(config: PublicPricingConfig): { input: PricingRequest; step: number; legacy: boolean } {
  const params = new URLSearchParams(window.location.search);
  const legacy = params.has("foundation") || params.has("mode") || (params.get("step") ?? "") in OLD_STEPS || ["basic", "large", "village"].some((key) => params.has(key));
  const customer: CustomerType = params.get("type") === "group" && offersGroup(config) ? "GROUP" : "COMPANY";
  const base = defaultRequest("NESTO_PLATFORM", config, customer);
  const count = (key: string, max = 500) => bounded(Number(params.get(key) ?? 0), 0, max);
  let rozaris: RozarisClass[] = (params.get("rozaris") ?? params.get("projectType") ?? "").split(",").map((value) => value.trim().toUpperCase()).filter((value): value is RozarisClass => (CLASSES as string[]).includes(value));
  if (!params.get("rozaris") && !params.get("projectType")) {
    rozaris = [...Array(count("basic", 50)).fill("BASIC"), ...Array(count("large", 50)).fill("LARGE"), ...Array(count("village", 50)).fill("VILLAGE")];
  }
  rozaris = rozaris.slice(0, 50);
  const projects = Math.max(rozaris.length, bounded(Number(params.get("projects") ?? config.nestoProjects.included), 1, 1_000));
  const input: PricingRequest = {
    foundation: "NESTO_PLATFORM",
    customer,
    modules: customer === "GROUP" ? [] : (params.get("modules") ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean),
    companies: customer === "GROUP" ? { fullGroup: Math.max(base.companies.fullGroup, count("group") || count("companies") - 1), jointVenture: count("jv"), documentsOnly: count("docs") } : base.companies,
    nestoProjects: { active: projects },
    rozarisProjects: rozaris.map((type) => ({ tempId: newProjectId(), type })),
    activeUsers: bounded(Number(params.get("users") ?? base.activeUsers), minUsers(config, customer), 100_000),
    contractMonths: params.get("term") === "12" ? 12 : 24,
    promotionCode: params.get("promo"),
  };
  const named = params.get("step") ?? "";
  const step = STEPS.indexOf((OLD_STEPS[named] ?? named) as Step);
  return { input: withPromotion(config, input, params.get("promo")), step: step >= 0 ? step : 0, legacy };
}

function urlFor(input: PricingRequest, step: number) {
  const params = new URLSearchParams();
  const group = input.customer === "GROUP";
  params.set("type", group ? "group" : "company");
  if (group) {
    params.set("companies", String(1 + input.companies.fullGroup));
    if (input.companies.jointVenture) params.set("jv", String(input.companies.jointVenture));
    if (input.companies.documentsOnly) params.set("docs", String(input.companies.documentsOnly));
  } else if (input.modules.length) {
    params.set("modules", input.modules.map((id) => id.toLowerCase()).join(","));
  }
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
  const properties = { customer: input.customer ?? "COMPANY", moduleCount: input.modules.length, contractMonths: input.contractMonths, companyCount: 1 + input.companies.fullGroup + input.companies.jointVenture, projectCount: input.nestoProjects?.active ?? 0, rozarisProjects: input.rozarisProjects?.map((project) => project.type) ?? [], userCount: input.activeUsers, ...extra };
  window.dispatchEvent(new CustomEvent("nesto:analytics", { detail: { event, properties } }));
}

type Ctx = { config: PublicPricingConfig; book: PricingConfig; input: PricingRequest; quote: PricingQuote; t: PricingCopy; money: (cents: number) => string; change: (next: PricingRequest, event?: string, extra?: Record<string, unknown>) => void };

export function PricingWizard({ initialConfig, copy, locale }: { initialConfig: PublicPricingConfig; copy: PricingCopy; locale: string }) {
  const t = copy;
  const book = React.useMemo(() => engineBook(initialConfig), [initialConfig]);
  // Never `Intl` with the reader's locale: Chrome has no Albanian data, so the server and the browser would print two different prices.
  const money = React.useCallback((cents: number) => numberText(cents / 100, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }, locale === "sq" ? "sq" : "en", "en"), [locale]);
  const initial = React.useMemo(() => withPromotion(initialConfig, defaultRequest("NESTO_PLATFORM", initialConfig)), [initialConfig]);
  const [input, setInput] = React.useState<PricingRequest>(initial);
  const [step, setStep] = React.useState(0);
  const [reached, setReached] = React.useState(0);
  const stepRef = React.useRef(step);
  stepRef.current = step;
  const estimate = React.useCallback((next: PricingRequest) => calculatePricing(next, book, promotionFor(initialConfig, next.contractMonths, next.promotionCode)), [book, initialConfig]);
  const [quote, setQuote] = React.useState<PricingQuote>(() => estimate(initial));
  const lastGood = React.useRef(quote);
  const [hydrated, setHydrated] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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

  /** A company keeps its modules; a group has them all. Projects, 3D, users and term carry over. */
  function chooseType(customer: CustomerType) {
    if (customer === (input.customer ?? "COMPANY")) return;
    const base = defaultRequest("NESTO_PLATFORM", initialConfig, customer);
    change({ ...input, customer, modules: customer === "GROUP" ? [] : input.modules, companies: base.companies, activeUsers: Math.max(base.activeUsers, input.activeUsers) }, "pricing_type_selected", { customer });
  }

  function move(target: number) {
    const next = bounded(target, 0, STEPS.length - 1);
    setStep(next);
    setReached((value) => Math.max(value, next));
    window.history.pushState({ pricingStep: next }, "", urlFor(input, next));
    document.getElementById("pricing-step-heading")?.focus({ preventScroll: true });
    document.getElementById("configurator")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (next === REVIEW) track("pricing_review_viewed", input);
  }

  const ctx: Ctx = { config: initialConfig, book, input, quote, t, money, change };
  const name = STEPS[step];
  const group = input.customer === "GROUP";

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
            <p className="mt-1.5 max-w-3xl text-body leading-relaxed text-fg-muted">{name === "modules" && group ? t.descriptions.modulesGroup : t.descriptions[name]}</p>
          </div>
          <div className="p-5 sm:p-7">
            {name === "type" ? <TypeStep ctx={ctx} choose={chooseType} /> : null}
            {name === "projects" ? <ProjectsStep ctx={ctx} /> : null}
            {name === "rozaris" ? <RozarisStep ctx={ctx} /> : null}
            {name === "modules" ? <ModulesStep ctx={ctx} /> : null}
            {name === "users" ? <UsersStep ctx={ctx} /> : null}
            {name === "contract" ? <ContractStep ctx={ctx} /> : null}
            {name === "review" ? <ReviewStep ctx={ctx} updating={updating} onProposal={(type) => { setProposal(type); track("pricing_proposal_started", input, { requestType: type }); }} /> : null}
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-7">
            <Button type="button" variant="secondary" size="lg" onClick={() => move(step - 1)} disabled={step === 0}><ArrowLeft aria-hidden="true" /> {t.back}</Button>
            {step < REVIEW ? <Button type="button" size="lg" onClick={() => move(step + 1)}>{t.continue} <ArrowRight aria-hidden="true" /></Button> : <Button type="button" variant="secondary" size="lg" onClick={() => move(0)}>{t.startOver}</Button>}
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

/** What the cheapest module costs a company, a month and for each user: the company card's "from" figures. */
function cheapestModule(config: PublicPricingConfig) {
  const sold = config.modules.filter((row) => isOffered(row, "NESTO_PLATFORM") && !row.includedInFoundations.includes("NESTO_PLATFORM"));
  const lowest = (cents: number[]) => (cents.length ? Math.min(...cents) : 0);
  return { month: lowest(sold.map((row) => row.monthlyPriceCents).filter((cents) => cents > 0)), user: lowest(sold.map((row) => row.monthlyPerUserCents).filter((cents) => cents > 0)) };
}

function TypeStep({ ctx, choose }: { ctx: Ctx; choose: (customer: CustomerType) => void }) {
  const { config, input, t, money, change } = ctx;
  const platform = config.foundations.find((row) => row.id === "NESTO_PLATFORM");
  const rules = config.customers;
  const companies = config.companies.NESTO_PLATFORM;
  const cheapest = cheapestModule(config);
  const chosen = input.customer ?? "COMPANY";
  const set = (key: keyof PricingRequest["companies"], value: number) => change({ ...input, companies: { ...input.companies, [key]: value } }, "pricing_company_changed");
  const cards: Array<{ id: CustomerType; name: string; body: string; price: string; min: string; from: string | null }> = [
    { id: "COMPANY", name: t.type.company, body: t.type.companyBody, price: fill(t.type.companyPrice, { module: money(cheapest.month), user: money(cheapest.user) }), min: fill(t.type.companyMin, { users: rules.company.minUsers }), from: platform?.minimumMonthlyCents ? fill(t.type.from, { price: money(platform.minimumMonthlyCents) }) : null },
    ...(offersGroup(config) ? [{ id: "GROUP" as const, name: t.type.group, body: t.type.groupBody, price: fill(t.type.groupPrice, { company: money(rules.group.perCompanyCents), user: money(rules.group.perUserCents) }), min: fill(t.type.groupMin, { companies: rules.group.minCompanies, users: rules.group.minUsers }), from: null }] : []),
  ];
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label={t.headings.type} className="grid gap-4 lg:grid-cols-2">
        {cards.map((card) => {
          const selected = chosen === card.id;
          return (
            <button key={card.id} type="button" role="radio" aria-checked={selected} onClick={() => choose(card.id)} data-testid={`type-${card.id.toLowerCase()}`} className={cn("flex w-full flex-col overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected ? "border-accent ring-2 ring-accent/15" : "border-line hover:border-line-strong")}>
              <Preview kind={card.id === "GROUP" ? "group" : "platform"} label={card.name} />
              <span className="flex flex-1 flex-col p-5">
                <span className="flex items-center justify-between gap-2"><strong className="text-card text-fg">{card.name}</strong><span className={cn("text-meta font-semibold", selected ? "text-accent-strong" : "text-fg-subtle")}>{selected ? <><CheckCircle2 className="mr-1 inline size-4" aria-hidden="true" />{t.type.selected}</> : t.type.choose}</span></span>
                <span className="mt-2 text-table leading-relaxed text-fg-muted">{card.body}</span>
                <span className="mt-3 text-table font-semibold text-fg">{card.price}</span>
                <span className="mt-1 text-meta text-fg-muted">{card.min}{card.from ? ` · ${card.from}` : ""}</span>
              </span>
            </button>
          );
        })}
      </div>
      {chosen === "GROUP" ? (
        <div className="space-y-3" data-testid="group-companies">
          <Stepper label={t.companies.companies} help={fill(t.companies.companiesHelp, { price: money(rules.group.perCompanyCents), min: rules.group.minCompanies })} value={1 + input.companies.fullGroup} min={rules.group.minCompanies} max={500} onChange={(value) => set("fullGroup", value - 1)} />
          {companies.jointVentureMonthlyCents > 0 ? <Stepper label={t.companies.jv} help={fill(t.companies.jvHelp, { price: money(companies.jointVentureMonthlyCents) })} value={input.companies.jointVenture} max={500} onChange={(value) => set("jointVenture", value)} /> : null}
          {companies.documentsOnlyMonthlyCents > 0 ? <Stepper label={t.companies.documents} help={fill(t.companies.documentsHelp, { price: money(companies.documentsOnlyMonthlyCents) })} value={input.companies.documentsOnly} max={500} onChange={(value) => set("documentsOnly", value)} /> : null}
          <p className="text-meta text-fg-subtle">{t.companies.external}</p>
        </div>
      ) : null}
    </div>
  );
}

function ProjectsStep({ ctx }: { ctx: Ctx }) {
  const { config, input, t, money, change } = ctx;
  const active = input.nestoProjects?.active ?? config.nestoProjects.included;
  const extra = Math.max(0, active - config.nestoProjects.included);
  const price = config.nestoProjects.additionalMonthlyCents;
  // A 3D project is one of the portfolio's: fewer projects drop the last 3D ones.
  const setProjects = (value: number) => change({ ...input, nestoProjects: { active: value }, rozarisProjects: (input.rozarisProjects ?? []).slice(0, value) }, "pricing_projects_changed");
  return (
    <div className="space-y-3">
      <Stepper label={t.projects.portfolio} help={fill(t.projects.portfolioHelp, { price: money(price) })} value={active} min={1} max={1_000} onChange={setProjects} />
      {extra > 0 ? <p className="text-table text-fg-muted" data-testid="projects-line">{fill(t.projects.line, { extra, price: money(price), total: money(extra * price) })}</p> : null}
    </div>
  );
}

function RozarisStep({ ctx }: { ctx: Ctx }) {
  const { config, input, t, money, change } = ctx;
  const projects = input.rozarisProjects ?? [];
  const portfolio = input.nestoProjects?.active ?? config.nestoProjects.included;
  const term = input.contractMonths === 24 ? "monthly24Cents" : "monthly12Cents";
  const setProjects = (next: NonNullable<PricingRequest["rozarisProjects"]>, event: string) => change({ ...input, rozarisProjects: next }, event);
  const setCount = (n: number) => setProjects(n > projects.length ? [...projects, ...Array.from({ length: n - projects.length }, () => ({ tempId: newProjectId(), type: "BASIC" as RozarisClass }))] : projects.slice(0, n), "pricing_rozaris_count_changed");
  return (
    <div className="space-y-5">
      <RozarisSketches t={t} />
      <Stepper label={t.rozaris.count} help={fill(t.rozaris.countHelp, { n: portfolio })} value={projects.length} min={0} max={Math.min(50, portfolio)} onChange={setCount} />
      {projects.map((project, index) => (
        <fieldset key={project.tempId} className="rounded-xl border border-line p-4" data-testid="rozaris-project">
          <legend className="px-1 text-card font-semibold text-fg">{fill(t.rozaris.project, { n: index + 1 })}</legend>
          <div role="radiogroup" aria-label={t.rozaris.size} className="mt-1 grid gap-2 sm:grid-cols-3">
            {CLASSES.map((type) => {
              const rate = config.rozaris.classes[type];
              const words = t.classes[type];
              const on = project.type === type;
              return (
                <button key={type} type="button" role="radio" aria-checked={on} onClick={() => setProjects(projects.map((row) => (row.tempId === project.tempId ? { ...row, type } : row)), "pricing_project_type_changed")} className={cn("flex min-h-11 flex-col rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-accent bg-accent-soft/40" : "border-line hover:border-line-strong")}>
                  <Preview kind={type.toLowerCase() as "basic" | "large" | "village"} label={words?.name ?? rate.name} small />
                  <span className="mt-2 text-table font-semibold text-fg">{words?.name ?? rate.name}</span>
                  <span className="text-table text-fg">{fill(t.rozaris.perMonth, { price: money(rate[term]) })}</span>
                  <span className="mt-1 text-meta leading-snug text-fg-subtle">{words?.guidance ?? rate.guidance}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      {projects.length ? <div className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-table"><p className="font-semibold text-warning-strong">{t.rozaris.production}</p><p className="mt-1 text-fg-muted">{t.rozaris.review}</p></div> : null}
    </div>
  );
}

/** Which words say why a module costs nothing here. */
function includedWords(t: PricingCopy, reason: ModuleReason): string {
  return reason === "ROZARIS" ? t.modules.includedRozaris : reason === "GROUP" ? t.modules.includedGroup : t.modules.includedFree;
}

function ModulesStep({ ctx }: { ctx: Ctx }) {
  const { config, book, input, t, change } = ctx;
  const customer = input.customer ?? "COMPANY";
  const rozaris3d = hasRozarisProjects(input);
  const resolved = React.useMemo(() => resolveModules(book, "NESTO_PLATFORM", input.modules, { customer, users: input.activeUsers, rozaris3d }).rows, [book, input.modules, customer, input.activeUsers, rozaris3d]);
  const held = new Map(resolved.map((row) => [row.id, row]));
  const shown = config.modules.filter((row) => isOffered(row, "NESTO_PLATFORM")).sort((a, b) => a.sortOrder - b.sortOrder);
  const absorbedBy = (row: PricingModule) => config.modules.find((other) => held.get(other.id)?.reason === "SELECTED" && other.absorbs.includes(row.id));
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

function ModuleCard({ row, ctx, held, absorbedBy, onToggle }: { row: PricingModule; ctx: Ctx; held?: { included: boolean; reason: ModuleReason }; absorbedBy?: PricingModule; onToggle: () => void }) {
  const { t, money } = ctx;
  const [open, setOpen] = React.useState(false);
  const words = t.moduleText[row.id];
  const included = Boolean(held?.included);
  const selected = Boolean(held) || Boolean(absorbedBy);
  const price = [row.monthlyPriceCents > 0 ? fill(t.modules.perMonth, { price: money(row.monthlyPriceCents) }) : null, row.monthlyPerUserCents > 0 ? fill(t.modules.perUser, { price: money(row.monthlyPerUserCents) }) : null].filter(Boolean).join(" + ");
  const state = held?.included ? includedWords(t, held.reason) : absorbedBy ? fill(t.modules.absorbed, { name: t.moduleText[absorbedBy.id]?.name ?? absorbedBy.name }) : price;
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
        {included ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-success/30 bg-success-soft px-3 text-table font-medium text-success-strong"><Lock className="size-3.5" aria-hidden="true" />{t.modules.included}</span>
        ) : absorbedBy ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 px-1 text-table font-medium text-success-strong"><Check className="size-4" aria-hidden="true" />{t.modules.included}</span>
        ) : (
          <Button type="button" size="sm" className="min-h-11" variant={held ? "secondary" : "primary"} aria-pressed={Boolean(held)} onClick={onToggle}>{held ? t.modules.remove : t.modules.add}</Button>
        )}
      </div>
    </article>
  );
}

function UsersStep({ ctx }: { ctx: Ctx }) {
  const { config, input, quote, t, money, change } = ctx;
  const customer = input.customer ?? "COMPANY";
  const min = minUsers(config, customer);
  // A company: each user pays the chosen modules' per-user prices; a group: its own price per user.
  const perUser = quote.group ? quote.group.perUserCents : quote.modules.filter((row) => !row.included).reduce((sum, row) => sum + row.perUserCents, 0);
  const line = quote.group
    ? fill(t.users.groupLine, { users: quote.users.requested, perUser: money(perUser), total: money(perUser * quote.users.requested) })
    : perUser > 0 ? fill(t.users.companyLine, { users: quote.users.requested, perUser: money(perUser), total: money(perUser * quote.users.requested) }) : t.users.noModules;
  return (
    <div className="space-y-4">
      <Stepper label={t.users.requested} help={fill(t.users.requestedHelp, { min })} value={input.activeUsers} min={min} max={100_000} onChange={(activeUsers) => change({ ...input, activeUsers }, "pricing_users_changed")} />
      <p className="rounded-xl border border-line bg-canvas p-4 text-table text-fg" data-testid="users-line">{line}</p>
      {quote.minimum.topUpCents > 0 ? (
        <p className="border border-line bg-accent-soft/40 p-4 text-table text-fg" data-testid="minimum-note">
          {fill(t.users.minimumNote, { charges: money(quote.standardMonthlyCents - quote.minimum.topUpCents), minimum: money(quote.minimum.monthlyCents) })}
        </p>
      ) : null}
      <Included icon={<Users />} title={fill(t.users.requestedHelp, { min })} />
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
          const offer = promotionFor(config, months);
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

/** Every line of the price, each with how it is worked out (docs/pricing-modules.md). */
function priceLines(ctx: Ctx): Array<[string, string, number | null]> {
  const { config, quote, t, money } = ctx;
  const name = (row: { id: string; name: string }) => t.moduleText[row.id]?.name ?? row.name;
  const companies = config.companies.NESTO_PLATFORM;
  const users = quote.users.requested;
  const lines: Array<[string, string, number | null]> = [];
  if (quote.group) {
    lines.push([t.review.group, fill(t.review.groupLine, { companies: quote.group.companies, perCompany: money(quote.group.perCompanyCents), users: quote.group.users, perUser: money(quote.group.perUserCents) }), quote.group.monthlyCents]);
  } else {
    for (const row of quote.modules.filter((item) => !item.included)) {
      const month = Math.max(0, row.monthlyCents - row.perUserCents * users);
      lines.push([t.review.module, fill(t.review.moduleLine, { name: name(row), month: money(month), users, perUser: money(row.perUserCents) }), row.monthlyCents]);
    }
  }
  const free = quote.modules.filter((row) => row.included && row.reason !== "GROUP");
  if (free.length) lines.push([t.review.included, free.map(name).join(", "), null]);
  if (quote.companies.jointVenture) lines.push([t.review.companies, fill(t.review.jvLine, { n: quote.companies.jointVenture, price: money(companies.jointVentureMonthlyCents) }), quote.companies.jointVenture * companies.jointVentureMonthlyCents]);
  if (quote.companies.documentsOnly) lines.push([t.review.companies, fill(t.review.documentsLine, { n: quote.companies.documentsOnly, price: money(companies.documentsOnlyMonthlyCents) }), quote.companies.documentsOnly * companies.documentsOnlyMonthlyCents]);
  const portfolio = quote.projects.find((project) => project.type === "NESTO");
  if (portfolio) {
    const active = quote.normalizedConfiguration.nestoProjects?.active ?? 1;
    const extra = Math.max(0, active - config.nestoProjects.included);
    lines.push([t.review.projects, extra ? fill(t.review.projectsLine, { n: active, extra, price: money(config.nestoProjects.additionalMonthlyCents) }) : fill(t.review.projectsOne, { n: active }), portfolio.monthlyCents || null]);
  }
  quote.projects.filter((project) => project.type !== "NESTO").forEach((project, index) => {
    lines.push([t.review.rozaris, fill(t.review.rozarisLine, { n: index + 1, size: t.classes[project.type]?.name ?? config.rozaris.classes[project.type as RozarisClass]?.name ?? project.type }), project.monthlyCents]);
  });
  lines.push([t.review.users, String(users), null]);
  if (quote.minimum.topUpCents > 0) lines.push([t.review.minimum, fill(t.review.minimumLine, { price: money(quote.minimum.monthlyCents) }), quote.minimum.topUpCents]);
  return lines;
}

function ReviewStep({ ctx, updating, onProposal }: { ctx: Ctx; updating: boolean; onProposal: (type: ProposalType) => void }) {
  const { input, quote, t, money } = ctx;
  const rows: Array<[string, string, number | null]> = [...priceLines(ctx), [t.review.contract, fill(t.contract.months, { n: quote.contractMonths }), null]];
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
        <p className="mt-2 text-display font-display">{money(quote.preIndexationContractValueCents)}</p>
        <p className="mt-1 text-table text-graphite-fg/70">{t.contract.hicpNote}</p>
        {quote.quoteReference ? <p className="mt-3 font-mono text-table">{fill(t.review.reference, { ref: quote.quoteReference })}</p> : updating ? <p className="mt-3 text-table text-graphite-fg/70">{t.review.saving}</p> : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" size="lg" disabled={updating || !quote.quoteId} onClick={() => onProposal("FORMAL_PROPOSAL")}>{t.review.proposal}</Button>
        <Button type="button" size="lg" variant="secondary" disabled={updating || !quote.quoteId} onClick={() => onProposal("TALK_TO_SALES")}>{t.review.talk}</Button>
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
  const chosen = quote.modules.filter((row) => !row.included);
  const rozaris = quote.projects.filter((project) => project.type !== "NESTO");
  const rows: Array<[string, string]> = [[t.estimate.type, quote.group ? fill(t.estimate.group, { n: quote.group.companies }) : t.estimate.company]];
  if (step >= 1) rows.push([t.estimate.projects, String(quote.normalizedConfiguration.nestoProjects?.active ?? 1)]);
  if (step >= 2 && rozaris.length) rows.push([t.estimate.rozaris, rozaris.map((project) => t.classes[project.type]?.name ?? config.rozaris.classes[project.type as RozarisClass]?.name).join(", ")]);
  if (step >= 3) rows.push([t.estimate.modules, quote.group ? t.estimate.modulesGroup : fill(t.estimate.modulesChosen, { n: chosen.length })]);
  if (step >= 4) rows.push([t.estimate.users, String(quote.users.requested)]);
  if (quote.minimum.topUpCents > 0) rows.push([t.estimate.minimum, fill(t.estimate.minimumApplies, { price: money(quote.minimum.monthlyCents) })]);
  if (step >= 5) rows.push([t.estimate.contract, fill(t.contract.months, { n: quote.contractMonths })]);
  if (step >= 5 && quote.promotion.applied) rows.push([t.estimate.promotion, quote.schedule.filter((period) => period.discountPercent).map((period) => fill(t.review.monthsRange, { from: period.fromMonth, to: period.toMonth }) + ` −${period.discountPercent}%`).join(" · ")]);
  return (
    <aside id="pricing-estimate" className="scroll-mt-24 overflow-hidden rounded-2xl border border-line bg-surface shadow-card xl:sticky xl:top-24" aria-label={t.estimate.label}>
      <div className="bg-graphite p-6 text-graphite-fg">
        <div className="flex items-center justify-between">
          <p className="nesto-eyebrow text-graphite-fg/60">{t.estimate.label}</p>
          {updating ? <span className="inline-flex items-center gap-1.5 text-meta text-graphite-fg/70"><RefreshCw className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> {t.estimate.updating}</span> : null}
        </div>
        <p className="mt-3 text-display font-display" aria-live="polite" data-testid="estimate-monthly">{money(quote.standardMonthlyCents)}<span className="text-table font-normal text-graphite-fg/70"> {t.estimate.perMonth}</span></p>
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

/* ------------------------------------------------------------- sketches -- */

/**
 * What a ROZARIS 3D experience is, in three line sketches in the site's
 * drawing style: the building to turn, its units coloured by status, a unit's
 * sheet. Drawn, not screenshots: no network request, both themes.
 */
function RozarisSketches({ t }: { t: PricingCopy }) {
  const words = t.rozaris;
  const frame = "block h-auto w-full text-fg";
  const sketches = [
    // 1 · The building in 3D: a block in two-point view with an orbit arrow round it.
    <svg key="building" viewBox="0 0 200 140" className={frame} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M100 28 L150 46 L150 112 L100 128 L50 112 L50 46 Z" />
        <path d="M100 28 L100 128 M50 46 L100 62 L150 46" />
        <path d="M100 62 L100 128" />
        {[0, 1, 2, 3].map((i) => <path key={i} d={`M50 ${62 + i * 13} L100 ${78 + i * 13} L150 ${62 + i * 13}`} strokeWidth="1" />)}
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="4 4" className="text-accent-strong">
        <ellipse cx="100" cy="122" rx="88" ry="14" />
      </g>
      <path d="M182 116 l6 6 -8 3" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent-strong" />
    </svg>,
    // 2 · Every unit, live: a front elevation, each unit filled by status.
    <svg key="units" viewBox="0 0 200 140" className={frame} aria-hidden="true">
      <rect x="40" y="14" width="120" height="112" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {Array.from({ length: 5 }, (_, row) => Array.from({ length: 4 }, (_, col) => {
        const status = (row * 4 + col) % 7 === 0 ? "fill-danger" : (row * 4 + col) % 5 === 1 ? "fill-warning" : "fill-success";
        return <rect key={`${row}-${col}`} x={48 + col * 28} y={22 + row * 20} width="20" height="13" className={cn(status, "opacity-80")} stroke="currentColor" strokeWidth="0.75" />;
      }))}
      <path d="M40 126 H160" stroke="currentColor" strokeWidth="3" />
    </svg>,
    // 3 · The unit's sheet: a plan, its figures, a button to reserve.
    <svg key="sheet" viewBox="0 0 200 140" className={frame} aria-hidden="true">
      <rect x="24" y="10" width="152" height="120" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <g fill="none" stroke="currentColor" strokeWidth="1.25">
        <rect x="36" y="22" width="72" height="62" />
        <path d="M72 22 V60 M36 60 H108 M88 60 V84" />
        <path d="M56 84 a10 10 0 0 1 10 -10" strokeWidth="1" />
      </g>
      <g className="fill-current text-fg-muted">
        <rect x="118" y="24" width="46" height="5" rx="2" />
        <rect x="118" y="36" width="34" height="5" rx="2" />
        <rect x="118" y="48" width="40" height="5" rx="2" />
      </g>
      <rect x="118" y="62" width="46" height="9" rx="2" className="fill-accent" />
      <rect x="36" y="96" width="128" height="22" rx="3" className="fill-accent-soft" stroke="currentColor" strokeWidth="1.25" />
      <path d="M92 107 h16 m-5 -4 4 4 -4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>,
  ];
  return (
    <section aria-labelledby="rozaris-what" className="rounded-xl border border-line bg-canvas p-5" data-testid="rozaris-sketches">
      <h3 id="rozaris-what" className="text-card font-semibold text-fg">{words.what}</h3>
      <p className="mt-1 max-w-2xl text-table text-fg-muted">{words.intro}</p>
      <ol className="mt-4 grid gap-4 md:grid-cols-3">
        {words.sketches.map((sketch, index) => (
          <li key={sketch.title} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 [background-image:linear-gradient(to_right,var(--nesto-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--nesto-border)_1px,transparent_1px)] [background-size:16px_16px]">
            {sketches[index]}
            <p className="text-table font-semibold text-fg">{sketch.title}</p>
            <p className="text-meta leading-snug text-fg-muted">{sketch.body}</p>
            {index === 1 ? (
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-micro text-fg-muted">
                {([["bg-success", words.legend.available], ["bg-warning", words.legend.reserved], ["bg-danger", words.legend.sold]] as const).map(([tone, label]) => <li key={label} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 opacity-80", tone)} aria-hidden="true" />{label}</li>)}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="mt-4 flex items-start gap-2 text-table text-fg"><Orbit className="mt-0.5 size-4 shrink-0 text-accent-strong" aria-hidden="true" />{words.salesIncluded}</p>
    </section>
  );
}

/* -------------------------------------------------------------- visuals -- */

/**
 * A light product illustration standing where a screenshot goes (§8, §16, §46):
 * shaped like the screen it stands for, no live 3D, no network request. A
 * real screenshot replaces it by its price-book `imageKey`.
 */
function Preview({ kind, label, small = false }: { kind: "rozaris" | "platform" | "group" | "module" | "basic" | "large" | "village"; label: string; small?: boolean }) {
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
      {kind === "group" ? (
        // Several companies under one group: a row of workspaces joined by one line.
        <span className="absolute inset-x-4 inset-y-5 flex items-end justify-between gap-2">
          {[72, 92, 60, 84].map((height, index) => (
            <span key={index} className="flex flex-1 flex-col gap-1 rounded-lg border border-line bg-surface p-1.5" style={{ height }}>
              {Array.from({ length: 3 }, (_, line) => <span key={line} className={cn("block h-1.5 rounded", line === 0 ? "bg-accent" : "bg-hover")} />)}
            </span>
          ))}
          <span className="absolute inset-x-0 -bottom-1.5 h-0.5 bg-accent" aria-hidden="true" />
        </span>
      ) : kind === "rozaris" ? (
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
          <div className="mt-6 rounded-xl border border-success/30 bg-success-soft p-5 text-center"><p className="text-table text-fg-muted">{t.proposal.yourReference}</p><p className="mt-1 font-mono text-section font-medium text-fg">{reference}</p><Button type="button" className="mt-5" onClick={() => onOpenChange(false)}>{t.proposal.done}</Button></div>
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
