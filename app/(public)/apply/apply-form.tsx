"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Minus, Plus, TriangleAlert } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applicantRoles,
  applicationKinds,
  companySizes,
  startWindows,
  type ApplicantRole,
  type ApplicationDepartment,
  type ApplicationKind,
  type CompanySize,
  type StartWindow,
} from "@/config/marketing";
import { submitApplicationAction } from "@/lib/actions/apply";
import type { Locale } from "@/lib/i18n/config";
import { fill, type SiteCopy } from "@/lib/i18n/site";
import { APPLICATION_STEPS, createApplicationSchema, type ApplicationInput, type ApplicationStep } from "@/lib/marketing/apply-schema";
import { formatEuros, sampleEstimateCents } from "@/lib/marketing/price-book";
import type { PublicPricingConfig } from "@/lib/modules/pricing/pricing.types";
import { cn } from "@/lib/utils/cn";

type Copy = SiteCopy["apply"];

type Draft = Omit<ApplicationInput, "kind" | "size" | "role" | "start" | "consent"> & {
  kind?: ApplicationKind;
  size?: CompanySize;
  role?: ApplicantRole;
  start?: StartWindow;
  consent: boolean;
};

const STEPS = Object.keys(APPLICATION_STEPS) as ApplicationStep[];
const EMPTY: Draft = { company: "", country: "", city: "", name: "", email: "", phone: "", departments: [], projects: 1, users: 15, consent: false, website: "" };

const labelClass = "font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-muted";
const pill = "inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line-strong px-4 text-table text-fg-muted transition-colors hover:text-fg peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring";

/**
 * The application: four steps beside a drawn permit (UI-05 §6). Each step is
 * checked against the server's own schema before the next opens; the permit
 * fills in as the applicant answers, and the sample estimate is read from the
 * live price book — or left out when there is none.
 */
export function ApplyForm({
  copy,
  departments,
  pricing,
  locale,
}: {
  copy: Copy;
  departments: { key: ApplicationDepartment; label: string }[];
  pricing: PublicPricingConfig | null;
  locale: Locale;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [index, setIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [received, setReceived] = useState<string | null>(null);
  const [permitOpen, setPermitOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const schema = useMemo(() => createApplicationSchema(copy.errors), [copy.errors]);

  const step = STEPS[index];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  /** The step's own fields, against the server's schema; the first message per field. */
  const check = (fields: readonly (keyof ApplicationInput)[]) => {
    const mask = Object.fromEntries(fields.map((field) => [field, true])) as { [K in keyof ApplicationInput]?: true };
    const result = schema.pick(mask).safeParse(draft);
    const found: Record<string, string> = {};
    if (!result.success) for (const issue of result.error.issues) found[String(issue.path[0])] ??= issue.message;
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const goTo = (next: number) => {
    setIndex(next);
    setFormError(null);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const onContinue = () => {
    if (!check(APPLICATION_STEPS[step])) return;
    if (index < STEPS.length - 1) return goTo(index + 1);
    const all = STEPS.flatMap((key) => APPLICATION_STEPS[key]);
    if (!check(all)) return;
    startTransition(async () => {
      const result = await submitApplicationAction(draft as ApplicationInput);
      if (result.ok) setReceived(result.reference);
      else setFormError(result.error);
    });
  };

  const estimate = pricing ? sampleEstimateCents(pricing, draft.projects, draft.users) : null;
  const firstName = draft.name.trim().split(/\s+/)[0] ?? "";

  const permit = (
    <Permit copy={copy} draft={draft} reference={received} estimate={estimate === null ? null : formatEuros(estimate, locale)} />
  );

  return (
    <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-[clamp(16px,4vw,48px)] py-8 lg:grid-cols-[200px_minmax(0,1fr)_320px] lg:gap-10 lg:py-12">
      {/* The steps, and who should not apply. */}
      <aside className="max-lg:hidden">
        <nav aria-label={copy.stepsLabel}>
          <ol className="flex flex-col gap-1">
            {STEPS.map((key, i) => {
              const state = received || i < index ? "done" : i === index ? "current" : "todo";
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={state !== "done" || Boolean(received)}
                    onClick={() => goTo(i)}
                    aria-current={state === "current" ? "step" : undefined}
                    className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left", state === "done" && !received && "hover:bg-hover")}
                  >
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[11px]", state === "todo" ? "border-line-strong text-fg-subtle" : "border-accent text-accent-strong", state === "current" && "bg-accent-soft")}>
                      {state === "done" ? <Check aria-hidden="true" className="size-3.5" /> : String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={cn("text-table", state === "current" ? "font-semibold text-fg" : "text-fg-muted")}>{copy.steps[key]}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="mt-8 flex flex-col gap-4 border-t border-line pt-5">
          <p className="text-meta leading-relaxed text-fg-muted"><span className="block font-semibold text-fg">{copy.notes.invited.title}</span>{copy.notes.invited.copy}</p>
          <p className="text-meta leading-relaxed text-fg-muted">
            <span className="flex items-center gap-2 font-semibold text-fg">
              {copy.notes.contractor.title}
              <span className="rounded-full border border-accent px-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-accent-strong">{copy.notes.contractor.soon}</span>
            </span>
            {copy.notes.contractor.copy}
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        {/* On a phone: the permit folds away above the form, and a bar shows how far along it is. */}
        <div className="mb-6 lg:hidden">
          <button type="button" onClick={() => setPermitOpen((open) => !open)} aria-expanded={permitOpen} className="text-table font-medium text-fg underline underline-offset-4">
            {permitOpen ? copy.permit.hide : copy.permit.show}
          </button>
          {permitOpen ? <div className="mt-3">{permit}</div> : null}
          {!received ? (
            <div className="mt-4">
              <p className="nesto-eyebrow text-fg-subtle">{fill(copy.stepOf, { n: index + 1, total: STEPS.length })} · {copy.steps[step]}</p>
              <div className="mt-2 h-1 rounded-full bg-line">
                <div className="h-1 rounded-full bg-accent transition-[width]" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
              </div>
            </div>
          ) : null}
        </div>

        {received ? (
          <section aria-labelledby="apply-done" className="flex flex-col items-start gap-6" data-testid="apply-received">
            <span className="site-stamp">
              <span className="text-[13px] font-semibold">{copy.done.stamp}</span>
              <span className="text-[11px]">{received}</span>
            </span>
            <h1 id="apply-done" ref={headingRef} tabIndex={-1} className="text-[44px] leading-[0.95] text-fg outline-none sm:text-[64px] font-display">
              {fill(copy.done.title, { name: firstName })}
            </h1>
            <p className="nesto-standfirst max-w-xl text-[19px] leading-snug">{fill(copy.done.lead, { reference: received, email: draft.email })}</p>
            <Timeline copy={copy} current={0} />
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href="/pricing">{copy.done.pricing}<ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="secondary"><Link href="/">{copy.done.home}</Link></Button>
            </div>
          </section>
        ) : (
          <form
            noValidate
            onSubmit={(event) => { event.preventDefault(); onContinue(); }}
            className="flex flex-col gap-7"
            data-testid="apply-form"
          >
            <div>
              <p className="nesto-eyebrow text-accent-strong">{copy.title}</p>
              <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-[40px] leading-[0.95] text-fg outline-none sm:text-[56px] font-display">
                {copy.steps[step]}<span aria-hidden="true" className="site-dot" />
              </h1>
              {index === 0 ? <p className="nesto-standfirst mt-3 max-w-xl text-[18px] leading-snug">{copy.lead}</p> : null}
            </div>

            {/* Honeypot: off-screen and out of the tab order. */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] size-px opacity-0" value={draft.website ?? ""} onChange={(event) => set("website", event.target.value)} />

            {step === "company" ? (
              <>
                <TextField id="company" label={copy.fields.company} value={draft.company} error={errors.company} onChange={(value) => set("company", value)} autoComplete="organization" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField id="country" label={copy.fields.country} placeholder={copy.fields.countryPlaceholder} value={draft.country} error={errors.country} onChange={(value) => set("country", value)} autoComplete="country-name" />
                  <TextField id="city" label={copy.fields.city} placeholder={copy.fields.cityPlaceholder} value={draft.city} error={errors.city} onChange={(value) => set("city", value)} autoComplete="address-level2" />
                </div>
                <Choice legend={copy.fields.kind} error={errors.kind}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {applicationKinds.map((kind) => (
                      <label key={kind} className="relative">
                        <input type="radio" name="kind" value={kind} checked={draft.kind === kind} onChange={() => set("kind", kind)} className="peer sr-only" />
                        <span className="flex min-h-[84px] cursor-pointer flex-col gap-1.5 rounded-xl border border-line-strong bg-surface px-4 py-3.5 transition-colors hover:border-control peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:shadow-[inset_0_0_0_1px_var(--nesto-accent)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                          <span className="text-body font-semibold text-fg">{copy.kinds[kind].title}</span>
                          <span className="text-table text-fg-muted">{copy.kinds[kind].copy}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </Choice>
                <Choice legend={copy.fields.size} error={errors.size}>
                  <Pills name="size" options={companySizes.map((size) => [size, size])} value={draft.size} onChange={(value) => set("size", value as CompanySize)} />
                </Choice>
              </>
            ) : null}

            {step === "you" ? (
              <>
                <TextField id="name" label={copy.fields.name} value={draft.name} error={errors.name} onChange={(value) => set("name", value)} autoComplete="name" />
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField id="email" type="email" label={copy.fields.email} value={draft.email} error={errors.email} onChange={(value) => set("email", value)} autoComplete="email" />
                  <TextField id="phone" type="tel" label={copy.fields.phone} hint={copy.fields.optional} value={draft.phone} error={errors.phone} onChange={(value) => set("phone", value)} autoComplete="tel" />
                </div>
                <Choice legend={copy.fields.role} error={errors.role}>
                  <Pills name="role" options={applicantRoles.map((role) => [role, copy.roles[role]])} value={draft.role} onChange={(value) => set("role", value as ApplicantRole)} />
                </Choice>
              </>
            ) : null}

            {step === "run" ? (
              <>
                <Choice legend={copy.fields.departments}>
                  <div className="flex flex-wrap gap-2">
                    {departments.map((department) => {
                      const on = draft.departments.includes(department.key);
                      return (
                        <label key={department.key}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => set("departments", on ? draft.departments.filter((key) => key !== department.key) : [...draft.departments, department.key])}
                            className="peer sr-only"
                          />
                          <span className={pill}>
                            {on ? <Check aria-hidden="true" className="-ml-1 mr-1.5 size-3.5" /> : null}
                            {department.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Choice>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Stepper id="projects" label={copy.fields.projects} value={draft.projects} min={1} max={99} step={1} onChange={(value) => set("projects", value)} fewer={copy.fewer} more={copy.more} />
                  <Stepper id="users" label={copy.fields.users} value={draft.users} min={5} max={500} step={5} onChange={(value) => set("users", value)} fewer={copy.fewer} more={copy.more} />
                </div>
                <Choice legend={copy.fields.start} error={errors.start}>
                  <Pills name="start" options={startWindows.map((start) => [start, copy.starts[start]])} value={draft.start} onChange={(value) => set("start", value as StartWindow)} />
                </Choice>
              </>
            ) : null}

            {step === "review" ? (
              <>
                <div className="lg:hidden">{permit}</div>
                <div>
                  <label className="flex cursor-pointer items-start gap-3 text-body text-fg">
                    <input
                      type="checkbox"
                      checked={draft.consent}
                      onChange={(event) => set("consent", event.target.checked)}
                      aria-invalid={Boolean(errors.consent)}
                      aria-describedby={errors.consent ? "consent-error" : undefined}
                      className="mt-0.5 size-5 shrink-0 accent-[var(--nesto-primary)]"
                    />
                    {copy.fields.consent}
                  </label>
                  {errors.consent ? <p id="consent-error" className="mt-2 text-table text-danger-strong">{errors.consent}</p> : null}
                </div>
                <Timeline copy={copy} current={-1} />
              </>
            ) : null}

            {formError ? (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-table text-danger-strong">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {formError}
              </p>
            ) : null}

            <div className="flex items-center gap-3 border-t border-line pt-5 max-lg:sticky max-lg:bottom-0 max-lg:-mx-[clamp(16px,4vw,48px)] max-lg:bg-canvas max-lg:px-[clamp(16px,4vw,48px)] max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
              {index > 0 ? (
                <Button type="button" variant="secondary" size="lg" onClick={() => goTo(index - 1)}>
                  <ArrowLeft />
                  {copy.back}
                </Button>
              ) : null}
              <Button type="submit" size="lg" className="ml-auto" disabled={isPending} data-testid="apply-continue">
                {step === "review" ? (isPending ? copy.sending : copy.submit) : copy.continue}
                <ArrowRight />
              </Button>
            </div>
          </form>
        )}
      </div>

      <aside className="max-lg:hidden">
        <div className="sticky top-6">{permit}</div>
      </aside>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  placeholder,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
        {hint ? <span className="ml-2 normal-case tracking-normal text-fg-subtle">· {hint}</span> : null}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-12 text-[15px]"
      />
      {error ? <p id={`${id}-error`} className="text-table text-danger-strong">{error}</p> : null}
    </div>
  );
}

function Choice({ legend, error, children }: { legend: string; error?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2.5" aria-invalid={Boolean(error) || undefined}>
      <legend className={cn(labelClass, "mb-2.5")}>{legend}</legend>
      {children}
      {error ? <p className="text-table text-danger-strong">{error}</p> : null}
    </fieldset>
  );
}

function Pills({ name, options, value, onChange }: { name: string; options: [string, string][]; value?: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([key, text]) => (
        <label key={key}>
          <input type="radio" name={name} value={key} checked={value === key} onChange={() => onChange(key)} className="peer sr-only" />
          <span className={pill}>{text}</span>
        </label>
      ))}
    </div>
  );
}

function Stepper({ id, label, value, min, max, step, onChange, fewer, more }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; fewer: string; more: string }) {
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2 self-start">
      <span id={`${id}-label`} className={labelClass}>{label}</span>
      <span className="inline-flex h-12 items-center self-start rounded-[10px] border border-control bg-surface">
        <button type="button" aria-label={`${fewer}: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} className="grid size-12 place-items-center text-fg disabled:text-fg-subtle">
          <Minus aria-hidden="true" className="size-4" />
        </button>
        <output aria-live="polite" className="min-w-12 text-center text-[17px] tabular-nums text-fg">{value}</output>
        <button type="button" aria-label={`${more}: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} className="grid size-12 place-items-center text-fg disabled:text-fg-subtle">
          <Plus aria-hidden="true" className="size-4" />
        </button>
      </span>
    </div>
  );
}

function Timeline({ copy, current }: { copy: Copy; current: number }) {
  return (
    <div>
      <h2 className="nesto-eyebrow text-fg-subtle">{copy.timeline.title}</h2>
      <ol className="mt-3 border-l-2 border-fg">
        {copy.timeline.items.map((item, i) => (
          <li key={item.title} className="relative py-2 pl-5">
            <span aria-hidden="true" className={cn("absolute -left-[7px] top-3.5 size-3 rounded-full border-2 border-fg", i <= current ? "bg-accent" : "bg-canvas")} />
            <span className="block text-body font-medium text-fg">{item.title}</span>
            <span className="block text-table text-fg-muted">{item.when}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The application as a permit: a title block that fills in as the applicant answers. */
function Permit({ copy, draft, reference, estimate }: { copy: Copy; draft: Draft; reference: string | null; estimate: string | null }) {
  const dash = "—";
  const cells: [string, string][] = [
    [copy.permit.company, draft.company.trim() || dash],
    [copy.permit.kind, draft.kind ? copy.kinds[draft.kind].title : dash],
    [copy.permit.applicant, draft.name.trim() || dash],
    [copy.permit.start, draft.start ? copy.starts[draft.start] : dash],
    [copy.permit.projects, String(draft.projects)],
    [copy.permit.users, String(draft.users)],
  ];

  return (
    <section aria-label={copy.permit.title} className="site-tb grid-cols-2 border-b-0 border-r-0" data-testid="apply-permit">
      <div className="site-tb-cell col-span-2">
        <span className="site-tb-k">{copy.permit.title}</span>
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[13px] text-fg">{copy.permit.number} {reference ?? "NST-····"}</span>
          <span className={cn("rounded-full border px-2 font-mono text-[10px] uppercase tracking-[0.12em]", reference ? "border-accent text-accent-strong" : "border-line-strong text-fg-subtle")}>
            {reference ? copy.permit.received : copy.permit.draft}
          </span>
        </span>
      </div>
      {cells.map(([key, value]) => (
        <div key={key} className="site-tb-cell">
          <span className="site-tb-k">{key}</span>
          <span className="truncate text-body font-medium text-fg">{value}</span>
        </div>
      ))}
      {estimate ? (
        <div className="site-tb-cell col-span-2 bg-accent-soft">
          <span className="site-tb-k">{copy.permit.estimate}</span>
          <span className="text-[30px] leading-none tabular-nums text-fg font-display">{fill(copy.permit.perMonth, { price: estimate })}</span>
          <span className="text-meta leading-relaxed text-fg-muted">{copy.permit.estimateNote}</span>
        </div>
      ) : null}
    </section>
  );
}
