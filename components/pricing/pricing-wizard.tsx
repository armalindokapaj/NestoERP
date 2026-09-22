"use client";

import * as React from "react";
import {
  ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, ChevronDown, ClipboardCheck,
  Gauge, Layers3, Minus, Orbit, Plus, RefreshCw, ShieldCheck, Sparkles, Users, WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_PRICING_REQUEST } from "@/lib/modules/pricing/pricing.config";
import { calculatePricing, hasRozarisProjects } from "@/lib/modules/pricing/pricing.engine";
import type { PricingQuote, PricingRequest, PublicPricingConfig } from "@/lib/modules/pricing/pricing.types";
import { cn } from "@/lib/utils/cn";

const steps = ["Product", "Companies", "Projects", "Users", "ROZARIS", "Contract", "Review"] as const;
const money = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const formatMoney = (amount: number) => money.format(amount);
const formatIndexSource = (source: string) => source === "EUROSTAT_HICP_EURO_AREA_ALL_ITEMS" ? "Euro Area HICP — All Items" : source.replaceAll("_", " ");
type ProposalType = "FORMAL_PROPOSAL" | "TALK_TO_SALES" | "THREE_D_PRODUCTION";

function matchingPromotion(config: PublicPricingConfig, input: PricingRequest) {
  return config.promotions.find((promotion) => promotion.code === input.promotionCode) ?? null;
}

function eligiblePromotion(
  config: PublicPricingConfig,
  productMode: PricingRequest["productMode"],
  contractMonths: PricingRequest["contractMonths"],
  requestedCode?: string | null,
) {
  const eligible = config.promotions.filter((promotion) => (
    promotion.enabled
    && promotion.product === productMode
    && promotion.requiredContractMonths === contractMonths
  ));
  return eligible.find((promotion) => promotion.code === requestedCode) ?? eligible[0] ?? null;
}

function configuredDefaultRequest(config: PublicPricingConfig): PricingRequest {
  const rules = config.publicRules.nestoERP;
  const request: PricingRequest = {
    ...DEFAULT_PRICING_REQUEST,
    companies: { ...DEFAULT_PRICING_REQUEST.companies },
    activeProjects: rules.includedProjects,
    activeUsers: rules.includedCompanies * rules.includedUsersPerFullCompany,
    rozaris: { ...DEFAULT_PRICING_REQUEST.rozaris },
    promotionCode: null,
  };
  return { ...request, promotionCode: eligiblePromotion(config, request.productMode, request.contractMonths)?.code ?? null };
}

function initialQuote(config: PublicPricingConfig, input: PricingRequest) {
  return calculatePricing(input, config.publicRules, matchingPromotion(config, input));
}

function bounded(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readUrlState(config: PublicPricingConfig): { configuration: PricingRequest; step: number } {
  const fallback = configuredDefaultRequest(config);
  if (typeof window === "undefined") return { configuration: fallback, step: 0 };
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "rozaris" ? "ROZARIS_ONLY" : "NESTO_ERP";
  const contractMonths = params.get("term") === "12" ? 12 : 24;
  const input: PricingRequest = {
    productMode: mode,
    companies: {
      additionalGroup: bounded(Number(params.get("group") ?? params.get("companies") ?? 0), 0, 500),
      jointVenture: bounded(Number(params.get("jv") ?? 0), 0, 500),
      documentsOnly: bounded(Number(params.get("docs") ?? 0), 0, 500),
    },
    activeProjects: mode === "NESTO_ERP" ? bounded(Number(params.get("projects") ?? config.publicRules.nestoERP.includedProjects), 1, 1_000) : 0,
    activeUsers: bounded(Number(params.get("users") ?? fallback.activeUsers), 1, 100_000),
    rozaris: {
      basicProjects: bounded(Number(params.get("basic") ?? 0), 0, 1_000),
      largeProjects: bounded(Number(params.get("large") ?? 0), 0, 1_000),
      villageProjects: bounded(Number(params.get("village") ?? 0), 0, 1_000),
    },
    contractMonths,
    promotionCode: null,
  };
  input.promotionCode = eligiblePromotion(config, mode, contractMonths, params.get("promo"))?.code ?? null;
  const namedStep = steps.findIndex((item) => item.toLowerCase() === params.get("step"));
  return { configuration: input, step: namedStep >= 0 ? namedStep : 0 };
}

function urlFor(input: PricingRequest, step: number) {
  const params = new URLSearchParams();
  params.set("mode", input.productMode === "NESTO_ERP" ? "erp" : "rozaris");
  if (input.companies.additionalGroup) params.set("group", String(input.companies.additionalGroup));
  if (input.companies.jointVenture) params.set("jv", String(input.companies.jointVenture));
  if (input.companies.documentsOnly) params.set("docs", String(input.companies.documentsOnly));
  if (input.productMode === "NESTO_ERP") params.set("projects", String(input.activeProjects));
  params.set("users", String(input.activeUsers));
  if (input.rozaris.basicProjects) params.set("basic", String(input.rozaris.basicProjects));
  if (input.rozaris.largeProjects) params.set("large", String(input.rozaris.largeProjects));
  if (input.rozaris.villageProjects) params.set("village", String(input.rozaris.villageProjects));
  params.set("term", String(input.contractMonths));
  if (input.promotionCode) params.set("promo", input.promotionCode);
  params.set("step", steps[step].toLowerCase());
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error?.message ?? "The request could not be completed.");
  return payload.data;
}

export function PricingWizard({ initialConfig }: { initialConfig: PublicPricingConfig }) {
  const configuredDefault = React.useMemo(() => configuredDefaultRequest(initialConfig), [initialConfig]);
  const [input, setInput] = React.useState<PricingRequest>(configuredDefault);
  const [step, setStep] = React.useState(0);
  const stepRef = React.useRef(step);
  stepRef.current = step;
  const [quote, setQuote] = React.useState<PricingQuote>(() => initialQuote(initialConfig, configuredDefault));
  const confirmedQuote = React.useRef(quote);
  const [hydrated, setHydrated] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const [priceError, setPriceError] = React.useState<string | null>(null);
  const [proposalType, setProposalType] = React.useState<ProposalType | null>(null);
  const [savedFingerprint, setSavedFingerprint] = React.useState<string | null>(null);
  const viewed = React.useRef(false);

  React.useEffect(() => {
    const state = readUrlState(initialConfig);
    setInput(state.configuration);
    setStep(state.step);
    const optimistic = initialQuote(initialConfig, state.configuration);
    setQuote(optimistic);
    confirmedQuote.current = optimistic;
    setHydrated(true);
  }, [initialConfig]);

  React.useEffect(() => {
    if (!hydrated || viewed.current) return;
    viewed.current = true;
    track("pricing_viewed", input);
  }, [hydrated, input]);

  React.useEffect(() => {
    if (!hydrated) return;
    const onPopState = () => {
      const state = readUrlState(initialConfig);
      setInput(state.configuration);
      setStep(state.step);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [hydrated, initialConfig]);

  React.useEffect(() => {
    if (!hydrated) return;
    const optimistic = initialQuote(initialConfig, input);
    setQuote(optimistic);
    setPriceError(null);
    setSavedFingerprint(null);
    window.history.replaceState({ pricingStep: stepRef.current }, "", urlFor(input, stepRef.current));
    if (stepRef.current === 6) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (stepRef.current === 6) return;
      setUpdating(true);
      try {
        const official = await postJson<PricingQuote>("/api/public/pricing/calculate", { ...input, persistQuote: false });
        if (!controller.signal.aborted && stepRef.current !== 6) {
          confirmedQuote.current = official;
          setQuote(official);
        }
      } catch {
        if (!controller.signal.aborted && stepRef.current !== 6) {
          setQuote(confirmedQuote.current);
          setPriceError("Unable to refresh price. Your last confirmed estimate is shown.");
        }
      } finally {
        if (!controller.signal.aborted && stepRef.current !== 6) setUpdating(false);
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [hydrated, initialConfig, input]);

  const fingerprint = React.useMemo(() => JSON.stringify(input), [input]);

  React.useEffect(() => {
    if (!hydrated || step !== 6 || savedFingerprint === fingerprint) return;
    if (input.productMode === "ROZARIS_ONLY" && !hasRozarisProjects(input)) return;
    let active = true;
    setUpdating(true);
    postJson<PricingQuote>("/api/public/pricing/calculate", { ...input, persistQuote: true })
      .then((saved) => {
        if (!active) return;
        confirmedQuote.current = saved;
        setQuote(saved);
        setSavedFingerprint(fingerprint);
        setPriceError(null);
      })
      .catch((error) => active && setPriceError(error instanceof Error ? error.message : "The quote could not be saved."))
      .finally(() => active && setUpdating(false));
    return () => { active = false; };
  }, [fingerprint, hydrated, input, savedFingerprint, step]);

  function change(next: PricingRequest) {
    if (JSON.stringify(next.companies) !== JSON.stringify(input.companies)) track("pricing_company_changed", next);
    if (next.activeProjects !== input.activeProjects) track("pricing_projects_changed", next);
    if (next.activeUsers !== input.activeUsers) track("pricing_users_changed", next);
    if (JSON.stringify(next.rozaris) !== JSON.stringify(input.rozaris)) track("pricing_rozaris_changed", next);
    if (next.contractMonths !== input.contractMonths) track("pricing_contract_changed", next);
    if (next.promotionCode && next.promotionCode !== input.promotionCode) track("pricing_promotion_applied", next);
    setInput(next);
    track("pricing_configuration_changed", next);
  }

  function selectProduct(productMode: PricingRequest["productMode"]) {
    const next = {
      ...input,
      productMode,
      activeProjects: productMode === "NESTO_ERP" ? Math.max(1, input.activeProjects) : 0,
      promotionCode: eligiblePromotion(initialConfig, productMode, input.contractMonths)?.code ?? null,
    };
    change(next);
    track("pricing_product_selected", next);
  }

  function move(next: number) {
    const target = bounded(next, 0, steps.length - 1);
    setStep(target);
    window.history.pushState({ pricingStep: target }, "", urlFor(input, target));
    document.getElementById("pricing-step-heading")?.focus({ preventScroll: true });
    document.getElementById("configurator")?.scrollIntoView({ behavior: "smooth", block: "start" });
    track("pricing_step_completed", input, { step: steps[step], nextStep: steps[target] });
    if (target === 6) track("pricing_review_viewed", input);
  }

  function openProposal(type: ProposalType) {
    setProposalType(type);
    track("pricing_proposal_started", input, { requestType: type });
  }

  const proposalBlocked = input.productMode === "ROZARIS_ONLY" && !hasRozarisProjects(input);

  return (
    <div>
      <header className="mb-7 flex flex-col gap-4 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="nesto-eyebrow text-fg-subtle">Interactive pricing configurator</p>
          <h2 className="mt-3 font-serif text-page text-fg sm:text-display">Build your NESTO</h2>
          <p className="mt-2 max-w-2xl text-body text-fg-muted">Seven guided decisions. A server-validated estimate. No artificial packages.</p>
        </div>
        <p className="text-meta text-fg-subtle">Price book {initialConfig.pricingVersion} · EUR · Excludes VAT</p>
      </header>

      <PricingProgress step={step} onStep={move} />

      <div className="mt-7 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <main className="min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="border-b border-line px-5 py-6 sm:px-8">
            <p className="nesto-eyebrow text-accent-strong">Step {step + 1} of {steps.length} · {steps[step]}</p>
            <h3 id="pricing-step-heading" tabIndex={-1} className="mt-3 text-page font-semibold text-fg outline-none">{stepHeading(step)}</h3>
            <p className="mt-2 max-w-3xl text-body leading-relaxed text-fg-muted">{stepDescription(step, input.productMode)}</p>
          </div>

          <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
            <div className="p-5 sm:p-8">
              {step === 0 ? <ProductStep input={input} config={initialConfig} select={selectProduct} /> : null}
              {step === 1 ? <CompaniesStep input={input} config={initialConfig} change={change} /> : null}
              {step === 2 ? <ProjectsStep input={input} config={initialConfig} change={change} /> : null}
              {step === 3 ? <UsersStep input={input} config={initialConfig} quote={quote} change={change} /> : null}
              {step === 4 ? <RozarisStep input={input} config={initialConfig} change={change} /> : null}
              {step === 5 ? <ContractStep input={input} config={initialConfig} quote={quote} change={change} /> : null}
              {step === 6 ? <ReviewStep input={input} config={initialConfig} quote={quote} updating={updating} blocked={proposalBlocked} onProposal={openProposal} /> : null}
            </div>
            <PricingVisual step={step} input={input} quote={quote} />
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-8">
            <Button type="button" variant="secondary" size="lg" onClick={() => move(step - 1)} disabled={step === 0}><ArrowLeft /> Back</Button>
            {step < 6 ? <Button type="button" size="lg" onClick={() => move(step + 1)}>Continue <ArrowRight /></Button> : <Button type="button" variant="secondary" size="lg" onClick={() => move(0)}>Start over</Button>}
          </footer>
        </main>

        <PricingSummary input={input} quote={quote} updating={updating} error={priceError} />
      </div>

      <ProposalDialog open={proposalType !== null} type={proposalType ?? "FORMAL_PROPOSAL"} quote={quote} onOpenChange={(open) => !open && setProposalType(null)} />
    </div>
  );
}

function PricingProgress({ step, onStep }: { step: number; onStep: (step: number) => void }) {
  return <nav aria-label="Pricing steps" className="overflow-x-auto pb-1"><ol className="flex min-w-[700px] gap-2">{steps.map((name, index) => <li key={name} className="min-w-0 flex-1"><button type="button" onClick={() => onStep(index)} aria-current={index === step ? "step" : undefined} className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 text-left text-table font-medium transition", index === step ? "border-accent bg-accent-soft text-accent-strong" : index < step ? "border-line bg-surface text-fg" : "border-line bg-canvas text-fg-subtle hover:bg-hover")}><span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-micro", index <= step ? "bg-accent text-accent-fg" : "bg-hover text-fg-subtle")}>{index < step ? <Check className="size-3" /> : index + 1}</span><span className="truncate">{name}</span></button></li>)}</ol></nav>;
}

function stepHeading(step: number) {
  return ["What do you need from NESTO?", "How is your organization structured?", "How many projects are active?", "How many people need login access?", "Add your ROZARIS projects", "Choose your contract term", "Review your commercial estimate"][step];
}

function stepDescription(step: number, mode: PricingRequest["productMode"]) {
  return [
    "Start with the complete operating platform or the focused ROZARIS project experience.",
    "Full companies receive their own workspace and included users. Documents-only access stays deliberately restricted.",
    mode === "NESTO_ERP" ? "Only projects used for current operational work count toward this estimate." : "ROZARIS projects are priced by classification, so the ERP active-project fee does not apply.",
    "Only enabled login accounts are priced. Workforce and employee records remain unlimited records, not paid seats.",
    "Classify each real-estate experience. Final classification is confirmed by NESTO before contract signature.",
    "The term changes ROZARIS monthly pricing and determines whether the current ERP launch offer applies.",
    "This is the exact configuration saved with the active price-book version when you request a proposal.",
  ][step];
}

function ProductStep({ input, config, select }: { input: PricingRequest; config: PublicPricingConfig; select: (mode: PricingRequest["productMode"]) => void }) {
  const rules = config.publicRules;
  const baseUsers = rules.nestoERP.includedCompanies * rules.nestoERP.includedUsersPerFullCompany;
  const lowestRozaris = Math.min(...Object.values(rules.rozaris.projectTypes).flatMap((type) => [type.monthly12Cents, type.monthly24Cents]));
  return <div className="grid gap-4"><ChoiceCard selected={input.productMode === "NESTO_ERP"} onClick={() => select("NESTO_ERP")} icon={<Layers3 />} title="Full NESTO ERP" price={`From ${formatMoney(rules.nestoERP.baseMonthlyCents / 100)} / month`} description="The complete construction and real-estate operating platform, with optional ROZARIS." items={[`${rules.nestoERP.includedCompanies} full ${rules.nestoERP.includedCompanies === 1 ? "company" : "companies"}`, `${rules.nestoERP.includedProjects} active ${rules.nestoERP.includedProjects === 1 ? "project" : "projects"}`, `${baseUsers} active users`]} /><ChoiceCard selected={input.productMode === "ROZARIS_ONLY"} onClick={() => select("ROZARIS_ONLY")} icon={<Orbit />} title="NESTO ROZARIS only" price={`From ${formatMoney(lowestRozaris / 100)} / project / month`} description="Units, contracts and the published 3D project experience without the full ERP module set." items={["Unit inventory and statuses", "Contracts and buyer links", "Published 3D viewer"]} /></div>;
}

function ChoiceCard({ selected, onClick, icon, title, price, description, items }: { selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; price: string; description: string; items: string[] }) {
  return <button type="button" onClick={onClick} aria-pressed={selected} className={cn("w-full rounded-xl border p-5 text-left transition", selected ? "border-accent bg-accent-soft/40 ring-2 ring-accent/10" : "border-line bg-surface hover:border-line-strong hover:bg-hover/40")}><span className="flex items-start gap-4"><span className={cn("grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5", selected ? "bg-accent text-accent-fg" : "bg-hover text-fg-muted")}>{icon}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><strong className="text-card text-fg">{title}</strong>{selected ? <span className="inline-flex items-center gap-1 text-meta font-semibold text-accent-strong"><CheckCircle2 className="size-4" /> Selected</span> : null}</span><span className="mt-1 block text-table font-semibold text-fg">{price}</span><span className="mt-2 block text-table leading-relaxed text-fg-muted">{description}</span><span className="mt-3 flex flex-wrap gap-x-4 gap-y-1">{items.map((item) => <span key={item} className="inline-flex items-center gap-1.5 text-meta text-fg-muted"><Check className="size-3.5 text-success-strong" />{item}</span>)}</span></span></span></button>;
}

type StepProps = { input: PricingRequest; config: PublicPricingConfig; change: (next: PricingRequest) => void };

function CompaniesStep({ input, config, change }: StepProps) {
  const rules = config.publicRules.nestoERP;
  return <div className="space-y-4"><IncludedLine icon={<Building2 />} title="Base company" detail={`Included · ${rules.includedUsersPerFullCompany} active users`} /><NumberStepper label="Additional Group Companies" value={input.companies.additionalGroup} max={500} help={`${formatMoney(rules.additionalGroupCompanyMonthlyCents / 100)} / company / month · +${rules.includedUsersPerFullCompany} included users`} onChange={(value) => change({ ...input, companies: { ...input.companies, additionalGroup: value } })} /><NumberStepper label="Joint Venture Companies" value={input.companies.jointVenture} max={500} help={`${formatMoney(rules.additionalJVCompanyMonthlyCents / 100)} / JV / month · +${rules.includedUsersPerFullCompany} included users`} onChange={(value) => change({ ...input, companies: { ...input.companies, jointVenture: value } })} /><NumberStepper label="Documents-Only Companies" value={input.companies.documentsOnly} max={500} help={`${formatMoney(rules.documentsOnlyCompanyMonthlyCents / 100)} / company / month · restricted documents access, no included users`} onChange={(value) => change({ ...input, companies: { ...input.companies, documentsOnly: value } })} /></div>;
}

function ProjectsStep({ input, config, change }: StepProps) {
  if (input.productMode === "ROZARIS_ONLY") return <InfoPanel icon={<Orbit />} title="No ERP active-project fee" text="Your ROZARIS project classes are configured in the next section and priced directly. Completed and archived projects do not affect this estimate." />;
  const rules = config.publicRules.nestoERP;
  return <div className="space-y-4"><IncludedLine icon={<Layers3 />} title={`${rules.includedProjects} active project included`} detail="Completed and archived projects are outside this calculator." /><NumberStepper label="Active NESTO Projects" value={input.activeProjects} min={1} max={1_000} help={`Every project above ${rules.includedProjects} adds ${formatMoney(rules.additionalProjectMonthlyCents / 100)} / month`} onChange={(activeProjects) => change({ ...input, activeProjects })} /><InfoPanel icon={<Gauge />} title="What active means" text="A project currently used for operational work in NESTO. Archival commercial rules can be agreed separately." /></div>;
}

function UsersStep({ input, config, quote, change }: StepProps & { quote: PricingQuote }) {
  const rules = config.publicRules.nestoERP;
  return <div className="space-y-4"><NumberStepper label="Requested Active Users" value={input.activeUsers} min={1} max={100_000} help="People with an enabled NESTO login" onChange={(activeUsers) => change({ ...input, activeUsers })} /><div className="rounded-xl border border-line bg-canvas p-5"><div className="grid gap-4 sm:grid-cols-2"><Stat label="Included users" value={String(quote.users.included)} /><Stat label="Users above allowance" value={String(quote.users.extra)} /><Stat label={`${rules.userPackSize}-user packs`} value={String(quote.users.packs)} /><Stat label="Monthly user add-on" value={formatMoney(quote.breakdown.additionalUsersMonthly)} /></div><p className="mt-4 border-t border-line pt-4 text-table text-fg-muted">{quote.users.extra === 0 ? "Your selected companies cover every requested active user." : `${quote.users.requested} requested − ${quote.users.included} included = ${quote.users.extra} extra. Rounded up to ${quote.users.packs} × ${rules.userPackSize}-user packs at ${formatMoney(rules.userPackMonthlyCents / 100)} each.`}</p></div><InfoPanel icon={<Users />} title="Employee records are different" text="You may keep workforce and employee records without paying for a login. A record counts only when active platform access is enabled." /></div>;
}

function RozarisStep({ input, config, change }: StepProps) {
  const types = config.publicRules.rozaris.projectTypes;
  const rate = (type: keyof typeof types) => types[type][input.contractMonths === 24 ? "monthly24Cents" : "monthly12Cents"] / 100;
  const update = (key: keyof PricingRequest["rozaris"], value: number) => change({ ...input, rozaris: { ...input.rozaris, [key]: value } });
  return <div className="space-y-4"><RozarisCard title="Basic Project" guidance="An individual building or limited site with a standard inventory structure." value={input.rozaris.basicProjects} price={rate("basic")} onChange={(value) => update("basicProjects", value)} /><RozarisCard title="Large Project" guidance="A larger residential or mixed-use development with multiple buildings or more complex setup." value={input.rozaris.largeProjects} price={rate("large")} onChange={(value) => update("largeProjects", value)} /><RozarisCard title="Village / Masterplan" guidance="A multi-zone campus, villa or resort village, or broad masterplan development." value={input.rozaris.villageProjects} price={rate("village")} onChange={(value) => update("villageProjects", value)} /><div className="rounded-xl border border-warning/40 bg-warning-soft p-4"><p className="text-table font-semibold text-warning-strong">3D model production is quoted separately.</p><p className="mt-1 text-table text-fg-muted">Recurring pricing covers the ROZARIS platform and published viewer. Final project classification is subject to NESTO review before contract signature.</p></div></div>;
}

function RozarisCard({ title, guidance, value, price, onChange }: { title: string; guidance: string; value: number; price: number; onChange: (value: number) => void }) {
  return <article className="rounded-xl border border-line p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-card font-semibold text-fg">{title}</h4><p className="text-table font-semibold text-fg">{formatMoney(price)} / project / month</p></div><details className="mt-2 group"><summary className="flex cursor-pointer list-none items-center gap-1 text-table font-medium text-accent-strong">Learn what qualifies <ChevronDown className="size-3.5 transition group-open:rotate-180" /></summary><p className="mt-2 text-table leading-relaxed text-fg-muted">{guidance}</p></details></div><CompactStepper label={`${title} count`} value={value} onChange={onChange} /></div></article>;
}

function promotionTimeline(config: PublicPricingConfig, input: PricingRequest, contractMonths: 12 | 24) {
  const promotion = eligiblePromotion(config, input.productMode, contractMonths);
  if (!promotion) return { promotion: null, items: ["Standard monthly pricing", "ROZARIS billed from month 1"] };
  let fromMonth = 1;
  const items = promotion.periods.map((period) => {
    const toMonth = fromMonth + period.months - 1;
    const product = input.productMode === "NESTO_ERP" ? "ERP" : "ROZARIS-only plan";
    const label = `Months ${fromMonth}–${toMonth}: ${period.discountPercent === 100 ? `${product} free` : `${period.discountPercent}% off ${product}`}`;
    fromMonth = toMonth + 1;
    return label;
  });
  if (fromMonth <= contractMonths) items.push(`Months ${fromMonth}–${contractMonths}: standard pricing`);
  items.push("ROZARIS billed from month 1");
  return { promotion, items };
}

function ContractStep({ input, config, quote, change }: StepProps & { quote: PricingQuote }) {
  const term24 = promotionTimeline(config, input, 24);
  const term12 = promotionTimeline(config, input, 12);
  const appliedPromotion = config.promotions.find((promotion) => promotion.code === quote.promotion.appliedCode);
  function choose(contractMonths: 12 | 24) { change({ ...input, contractMonths, promotionCode: eligiblePromotion(config, input.productMode, contractMonths)?.code ?? null }); }
  return <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><ChoiceCard selected={input.contractMonths === 24} onClick={() => choose(24)} icon={<Sparkles />} title="24 months" price="Best monthly ROZARIS rate" description={term24.promotion ? `${term24.promotion.displayName ?? term24.promotion.code} applies to eligible configurations.` : "Standard pricing applies for this product and term."} items={term24.items} /><ChoiceCard selected={input.contractMonths === 12} onClick={() => choose(12)} icon={<WalletCards />} title="12 months" price="Shorter commitment" description={term12.promotion ? `${term12.promotion.displayName ?? term12.promotion.code} applies to eligible configurations.` : "ROZARIS monthly rates are twice the 24-month rate; total base project value remains equal."} items={term12.items} /></div>{quote.promotion.applied ? <InfoPanel icon={<Sparkles />} title={`${appliedPromotion?.displayName ?? quote.promotion.appliedCode ?? "Promotion"} applied`} text={input.productMode === "NESTO_ERP" ? "The promotion reduces NESTO ERP fees only. Every ROZARIS project remains fully billed from the first month." : "The promotion reduces the configured standalone ROZARIS plan during its promotional periods."} /> : <InfoPanel icon={<ShieldCheck />} title="Standard pricing" text="No promotion applies to this product and term combination." />}{quote.indexation.enabled ? <div className="rounded-xl border border-line bg-canvas p-4"><p className="text-table font-semibold text-fg">Future indexation</p><p className="mt-1 text-table leading-relaxed text-fg-muted">Prices are fixed for the first 12 months. From month {quote.indexation.appliesFromMonth}, {formatIndexSource(quote.indexation.source)} may apply between {quote.indexation.floorPercent}% and {quote.indexation.capPercent}%. Future inflation is unknown and is not included in this estimate.</p></div> : <InfoPanel icon={<ShieldCheck />} title="No indexation configured" text="The active price book does not apply a future HICP adjustment to this estimate." />}</div>;
}

function ReviewStep({ input, config, quote, updating, blocked, onProposal }: { input: PricingRequest; config: PublicPricingConfig; quote: PricingQuote; updating: boolean; blocked: boolean; onProposal: (type: ProposalType) => void }) {
  const rules = config.publicRules.nestoERP;
  const rows = [["NESTO ERP base", quote.breakdown.basePlatformMonthly], [`${input.companies.additionalGroup} additional group companies`, quote.breakdown.groupCompaniesMonthly], [`${input.companies.jointVenture} JV companies`, quote.breakdown.jointVentureCompaniesMonthly], [`${input.companies.documentsOnly} documents-only companies`, quote.breakdown.documentsOnlyCompaniesMonthly], [`${Math.max(0, input.activeProjects - quote.included.includedProjects)} additional active projects`, quote.breakdown.additionalProjectsMonthly], [`${quote.users.packs} × ${rules.userPackSize}-user packs`, quote.breakdown.additionalUsersMonthly], ["ROZARIS projects", quote.breakdown.rozarisMonthly]] as const;
  return <div className="space-y-5"><div className="rounded-xl border border-line"><div className="border-b border-line px-4 py-3"><h4 className="text-card font-semibold text-fg">Monthly breakdown</h4></div><dl className="divide-y divide-line">{rows.filter(([, amount]) => amount > 0).map(([label, amount]) => <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 text-table"><dt className="text-fg-muted">{label}</dt><dd className="font-semibold text-fg">{formatMoney(amount)}</dd></div>)}<div className="flex items-center justify-between gap-4 bg-canvas px-4 py-4"><dt className="text-table font-semibold uppercase tracking-wide text-fg">Standard monthly</dt><dd className="text-section font-semibold text-fg">{formatMoney(quote.standardMonthly)}</dd></div></dl></div><div><h4 className="text-card font-semibold text-fg">Billing timeline</h4><div className="mt-3 grid gap-3 sm:grid-cols-3">{quote.promotionalSchedule.map((period) => <div key={`${period.fromMonth}-${period.toMonth}`} className="rounded-xl border border-line bg-canvas p-4"><p className="nesto-eyebrow text-fg-subtle">Month{period.fromMonth === period.toMonth ? "" : "s"} {period.fromMonth}{period.fromMonth === period.toMonth ? "" : `–${period.toMonth}`}</p><p className="mt-2 text-section font-semibold text-fg">{formatMoney(period.totalMonthly)}<span className="text-meta font-normal text-fg-muted"> / mo</span></p>{period.discountPercent ? <p className="mt-1 text-meta text-success-strong">{period.discountPercent}% ERP discount</p> : null}</div>)}</div></div><div className="rounded-xl bg-graphite p-5 text-graphite-fg"><p className="nesto-eyebrow text-graphite-fg/55">Estimated {quote.contract.months}-month value</p><p className="mt-2 font-serif text-display">{formatMoney(quote.contract.preIndexationValue)}</p><p className="mt-2 text-table text-graphite-fg/65">{quote.indexation.enabled ? "Before future HICP adjustment" : "No HICP adjustment configured"} · Price book {quote.pricingVersion}</p>{quote.quoteReference ? <p className="mt-3 font-mono text-table text-graphite-fg">Reference {quote.quoteReference}</p> : updating ? <p className="mt-3 text-table text-graphite-fg/70">Saving this configuration…</p> : null}</div>{blocked ? <p role="alert" className="rounded-lg bg-warning-soft p-3 text-table text-warning-strong">Add at least one ROZARIS project to request a formal proposal.</p> : null}<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"><Button type="button" size="lg" disabled={blocked || updating || !quote.quoteId} onClick={() => onProposal("FORMAL_PROPOSAL")}>Request Formal Proposal</Button><Button type="button" size="lg" variant="secondary" disabled={blocked || updating || !quote.quoteId} onClick={() => onProposal("TALK_TO_SALES")}>Talk to NESTO</Button>{hasRozarisProjects(input) ? <Button type="button" size="lg" variant="secondary" disabled={updating || !quote.quoteId} onClick={() => onProposal("THREE_D_PRODUCTION")}>Request 3D Production Quote</Button> : null}</div><ul className="grid gap-1 text-meta text-fg-subtle sm:grid-cols-2">{quote.exclusions.map((item) => <li key={item} className="flex gap-2"><span aria-hidden="true">—</span>{item}</li>)}</ul></div>;
}

function PricingVisual({ step, input, quote }: { step: number; input: PricingRequest; quote: PricingQuote }) {
  const visuals = [{ icon: input.productMode === "NESTO_ERP" ? <Layers3 /> : <Orbit />, title: input.productMode === "NESTO_ERP" ? "One operating system" : "Project sales in context", detail: input.productMode === "NESTO_ERP" ? ["Dashboard", "Projects", "Documents", "Finance", "Procurement", "People"] : ["3D Viewer", "Units", "Contracts", "Availability"] }, { icon: <Building2 />, title: `${quote.included.fullCompanies} full ${quote.included.fullCompanies === 1 ? "company" : "companies"}`, detail: ["Group structure", "Company context", "Joint ventures", "Controlled documents"] }, { icon: <Layers3 />, title: input.productMode === "NESTO_ERP" ? `${input.activeProjects} active ${input.activeProjects === 1 ? "project" : "projects"}` : "Direct ROZARIS pricing", detail: ["Active", "Completed", "Archived"] }, { icon: <Users />, title: `${quote.users.included} users included`, detail: [`${quote.users.requested} requested`, `${quote.users.extra} extra`, `${quote.users.packs} paid packs`] }, { icon: <Orbit />, title: `${input.rozaris.basicProjects + input.rozaris.largeProjects + input.rozaris.villageProjects} ROZARIS projects`, detail: ["Published 3D", "Unit inventory", "Contracts", "Buyer connection"] }, { icon: <WalletCards />, title: `${input.contractMonths}-month agreement`, detail: quote.promotion.applied ? ["Months 1–3", "Months 4–6", "Months 7–24"] : ["Standard monthly pricing", "HICP from anniversary"] }, { icon: <ClipboardCheck />, title: quote.quoteReference ?? "Validated commercial summary", detail: ["Configuration", "Price book", "Monthly schedule", "Exclusions"] }][step];
  return <aside className="relative overflow-hidden border-t border-line bg-canvas p-5 sm:p-8 lg:border-l lg:border-t-0"><div aria-hidden="true" className="absolute inset-0 opacity-40 [background-image:linear-gradient(to_right,var(--nesto-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--nesto-border)_1px,transparent_1px)] [background-size:28px_28px]" /><div className="relative"><p className="nesto-eyebrow text-fg-subtle">Configuration preview</p><div className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-strong [&_svg]:size-5">{visuals.icon}</span><div><p className="text-meta uppercase tracking-wide text-fg-subtle">NESTO / {steps[step]}</p><p className="text-card font-semibold text-fg">{visuals.title}</p></div></div><div className="mt-5 grid gap-2">{visuals.detail.map((item, index) => <div key={item} className="flex items-center gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5"><span className={cn("size-2 rounded-full", index === 0 ? "bg-accent" : "bg-line-strong")} /><span className="text-table text-fg-muted">{item}</span></div>)}</div><div className="mt-5 flex h-20 items-end gap-2 border-t border-line pt-4" aria-hidden="true">{[45, 72, 55, 88, 64, 95, 76].map((height, index) => <span key={index} className={cn("flex-1 rounded-t", index === step ? "bg-accent" : "bg-accent-soft")} style={{ height: `${height}%` }} />)}</div></div><p className="mt-4 text-meta leading-relaxed text-fg-subtle">Lightweight product illustration. No customer data or live 3D model is loaded.</p></div></aside>;
}

function PricingSummary({ input, quote, updating, error }: { input: PricingRequest; quote: PricingQuote; updating: boolean; error: string | null }) {
  return <aside className="sticky top-24 overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-live="polite"><div className="bg-graphite p-6 text-graphite-fg"><div className="flex items-center justify-between"><p className="nesto-eyebrow text-graphite-fg/55">Live estimate</p>{updating ? <span className="inline-flex items-center gap-1.5 text-meta text-graphite-fg/70"><RefreshCw className="size-3.5 animate-spin" /> Updating…</span> : <span className="inline-flex items-center gap-1.5 text-meta text-success"><CheckCircle2 className="size-3.5" /> Confirmed</span>}</div><p className="mt-4 font-serif text-display">{formatMoney(quote.standardMonthly)}<span className="text-table font-normal text-graphite-fg/65"> / month</span></p><p className="mt-2 text-table text-graphite-fg/65">Standard recurring price before promotions</p></div><dl className="divide-y divide-line px-5"><SummaryRow label="NESTO / access" value={formatMoney(quote.nestoMonthly)} /><SummaryRow label="ROZARIS" value={formatMoney(quote.breakdown.rozarisMonthly)} /><SummaryRow label="Full companies" value={String(quote.included.fullCompanies)} /><SummaryRow label="Active projects" value={input.productMode === "NESTO_ERP" ? String(input.activeProjects) : "Direct priced"} /><SummaryRow label="Users included" value={String(quote.users.included)} /><SummaryRow label="Extra user packs" value={String(quote.users.packs)} /><SummaryRow label="Contract term" value={`${quote.contract.months} months`} /><SummaryRow label="Promotion" value={quote.promotion.appliedCode ?? "None"} /></dl><div className="border-t border-line bg-canvas p-5"><p className="text-meta uppercase tracking-wide text-fg-subtle">Estimated contract value</p><p className="mt-1 text-section font-semibold text-fg">{formatMoney(quote.contract.preIndexationValue)}</p><p className="mt-1 text-meta text-fg-subtle">{quote.indexation.enabled ? "Before future HICP" : "No HICP adjustment configured"} · Excludes VAT</p>{error ? <p role="alert" className="mt-3 rounded-md bg-danger-soft p-2 text-meta text-danger-strong">{error}</p> : null}</div></aside>;
}

function ProposalDialog({ open, type, quote, onOpenChange }: { open: boolean; type: ProposalType; quote: PricingQuote; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = React.useState({ fullName: "", companyName: "", businessEmail: "", phone: "", message: "", consent: false, website: "" });
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reference, setReference] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setError(null); setReference(null); } }, [open, type]);
  const titles: Record<ProposalType, string> = { FORMAL_PROPOSAL: "Request a formal proposal", TALK_TO_SALES: "Talk to NESTO", THREE_D_PRODUCTION: "Request a 3D production quote" };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!quote.quoteId) return setError("Wait for the pricing configuration to be saved.");
    setPending(true); setError(null);
    try {
      const result = await postJson<{ reference: string }>("/api/public/pricing/lead", { quoteId: quote.quoteId, requestType: type, ...form });
      setReference(result.reference);
      track(type === "THREE_D_PRODUCTION" ? "pricing_3d_quote_requested" : "pricing_proposal_submitted", quote.configuration);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Your request could not be submitted."); }
    finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogTitle>{reference ? "Pricing configuration saved" : titles[type]}</DialogTitle><DialogDescription>{reference ? "NESTO can now review the exact configuration and price-book version you selected." : `Your ${quote.contract.months}-month estimate is ${formatMoney(quote.contract.preIndexationValue)} before VAT and future HICP adjustments.`}</DialogDescription>{reference ? <div className="mt-6 rounded-xl border border-success/30 bg-success-soft p-5 text-center"><CheckCircle2 className="mx-auto size-8 text-success-strong" /><p className="mt-3 text-table text-fg-muted">Your reference</p><p className="mt-1 font-mono text-section font-semibold text-fg">{reference}</p><Button type="button" className="mt-5" onClick={() => onOpenChange(false)}>Done</Button></div> : <form onSubmit={submit} className="mt-6 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" required><Input required maxLength={160} autoComplete="name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></Field><Field label="Company" required><Input required maxLength={200} autoComplete="organization" value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} /></Field><Field label="Business email" required><Input required type="email" maxLength={254} autoComplete="email" value={form.businessEmail} onChange={(event) => setForm({ ...form, businessEmail: event.target.value })} /></Field><Field label="Phone"><Input type="tel" maxLength={60} autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field></div><Field label="Message"><Textarea maxLength={2_000} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} /></Field><div className="hidden" aria-hidden="true"><label>Website<Input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} /></label></div><label className="flex cursor-pointer items-start gap-3 text-table text-fg-muted"><input type="checkbox" required checked={form.consent} onChange={(event) => setForm({ ...form, consent: event.target.checked })} className="mt-0.5 size-4 rounded border-line-strong" /><span>I agree that NESTO may contact me regarding this pricing configuration.</span></label>{error ? <p role="alert" className="rounded-md bg-danger-soft p-3 text-table text-danger-strong">{error}</p> : null}<DialogFooter><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={pending || !form.consent}>{pending ? "Submitting…" : "Submit request"}</Button></DialogFooter></form>}</DialogContent></Dialog>;
}

function NumberStepper({ label, value, onChange, help, min = 0, max }: { label: string; value: number; onChange: (value: number) => void; help: string; min?: number; max: number }) {
  const id = `pricing-${label.replaceAll(" ", "-").toLowerCase()}`;
  return <div className="rounded-xl border border-line p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><label htmlFor={id} className="text-card font-semibold text-fg">{label}</label><p className="mt-1 text-table text-fg-muted">{help}</p></div><div className="flex items-center" role="group" aria-label={label}><Button type="button" variant="secondary" size="icon" className="size-11 rounded-r-none" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Decrease ${label}`}><Minus /></Button><Input id={id} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(event) => onChange(bounded(event.target.valueAsNumber, min, max))} className="h-11 w-24 rounded-none border-x-0 text-center text-card font-semibold" /><Button type="button" variant="secondary" size="icon" className="size-11 rounded-l-none" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Increase ${label}`}><Plus /></Button></div></div></div>;
}

function CompactStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <div className="flex items-center" role="group" aria-label={label}><Button type="button" variant="secondary" size="icon" className="size-11 rounded-r-none" onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0} aria-label={`Decrease ${label}`}><Minus /></Button><span className="grid h-11 w-12 place-items-center border-y border-line-strong bg-surface text-card font-semibold text-fg">{value}</span><Button type="button" variant="secondary" size="icon" className="size-11 rounded-l-none" onClick={() => onChange(Math.min(1_000, value + 1))} aria-label={`Increase ${label}`}><Plus /></Button></div>; }
function IncludedLine({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) { return <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft p-4"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface text-success-strong [&_svg]:size-5">{icon}</span><div><p className="text-table font-semibold text-fg">{title}</p><p className="mt-0.5 text-meta text-fg-muted">{detail}</p></div></div>; }
function InfoPanel({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="flex items-start gap-3 rounded-xl border border-line bg-canvas p-4"><span className="mt-0.5 text-accent-strong [&_svg]:size-5">{icon}</span><div><p className="text-table font-semibold text-fg">{title}</p><p className="mt-1 text-table leading-relaxed text-fg-muted">{text}</p></div></div>; }
function Stat({ label, value }: { label: string; value: string }) { return <div><p className="text-meta text-fg-subtle">{label}</p><p className="mt-1 text-section font-semibold text-fg">{value}</p></div>; }
function SummaryRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 py-3 text-table"><dt className="text-fg-muted">{label}</dt><dd className="text-right font-semibold text-fg">{value}</dd></div>; }
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="block text-meta font-medium text-fg-muted">{label}{required ? <span className="text-danger-strong"> *</span> : null}<span className="mt-1.5 block">{children}</span></label>; }

function track(name: string, configuration: PricingRequest, extra: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const detail = { productMode: configuration.productMode, contractMonths: configuration.contractMonths, companyCount: 1 + configuration.companies.additionalGroup + configuration.companies.jointVenture, projectCount: configuration.activeProjects, userCount: configuration.activeUsers, rozarisProjectTypes: Object.entries(configuration.rozaris).filter(([, count]) => count > 0).map(([type]) => type), ...extra };
  window.dispatchEvent(new CustomEvent("nesto:analytics", { detail: { event: name, properties: detail } }));
}
