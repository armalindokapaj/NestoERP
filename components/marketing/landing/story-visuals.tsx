"use client";

import { ArrowDown, Check, Minus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fill } from "@/lib/i18n/site";
import type { LandingCopy } from "@/lib/i18n/site/landing";
import type { DemoState, LandingPersona, UnitStatus, VisualKey } from "@/lib/marketing/landing-stories";
import { cn } from "@/lib/utils/cn";

/**
 * The illustrative visuals of the landing presentation (Landing + Full View
 * PRD §41, §47, §92-§95). NESTO-styled simulations drawn from the product's
 * tokens rather than screenshots: they cannot leak tenant data (§91), they
 * weigh nothing (§77), and the same Unit can visibly carry its state from one
 * slide to the next (§41). Every control here changes the demo state; nothing
 * clickable is decorative (§92), and nothing writes ERP data (§42).
 */

type V = LandingCopy["visual"];

type VisualProps = {
  visual: VisualKey;
  slideId: string;
  persona: LandingPersona;
  demo: DemoState;
  onDemo: (next: Partial<DemoState>) => void;
  v: V;
};

const frame = "rounded-xl border border-line bg-surface shadow-sm";

function Frame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(frame, "overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-muted px-4 py-2.5">
        <span className="truncate text-table font-medium text-fg">{title}</span>
        <span className="flex gap-1" aria-hidden="true">
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
          <span className="size-2 rounded-full bg-line-strong" />
        </span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

function Tree({ root, items, highlight }: { root: string; items: readonly string[]; highlight?: (item: string) => boolean }) {
  return (
    <div className="text-body">
      <p className="font-semibold text-fg">{root}</p>
      <ul className="mt-2 space-y-1.5 border-l border-line-strong pl-4">
        {items.map((item) => (
          <li key={item} className={cn("relative text-fg-muted before:absolute before:-left-4 before:top-1/2 before:h-px before:w-3 before:bg-line-strong", highlight?.(item) && "font-medium text-fg")}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Flow({ steps, doneThrough = -1 }: { steps: readonly string[]; doneThrough?: number }) {
  return (
    <ol className="space-y-1">
      {steps.map((step, index) => (
        <li key={step} className="flex flex-col items-start">
          <span className={cn("inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-table", index <= doneThrough ? "border-transparent bg-success-soft text-success-strong" : "border-line bg-surface text-fg")}>
            {index <= doneThrough ? <Check aria-hidden="true" className="size-3.5" /> : null}
            {step}
          </span>
          {index < steps.length - 1 ? <ArrowDown aria-hidden="true" className="ml-3 mt-1 size-3.5 text-fg-subtle" /> : null}
        </li>
      ))}
    </ol>
  );
}

const statusTone: Record<UnitStatus, "success" | "warning" | "neutral"> = { AVAILABLE: "success", RESERVED: "warning", SOLD: "neutral" };

function StatusBadge({ status, v }: { status: UnitStatus; v: V }) {
  return <Badge tone={statusTone[status]} data-testid="demo-unit-status">{v.status[status]}</Badge>;
}

const UNITS: { code: string; status: UnitStatus; area: number; floor: number }[] = [
  { code: "A-101", status: "AVAILABLE", area: 86, floor: 1 },
  { code: "A-102", status: "AVAILABLE", area: 94, floor: 1 },
  { code: "A-103", status: "RESERVED", area: 78, floor: 1 },
  { code: "A-104", status: "SOLD", area: 102, floor: 1 },
  { code: "A-203", status: "SOLD", area: 88, floor: 2 },
  { code: "A-204", status: "AVAILABLE", area: 112, floor: 2 },
];

function UnitGrid({ demo, onDemo, v, plan = false }: { demo: DemoState; onDemo: VisualProps["onDemo"]; v: V; plan?: boolean }) {
  return (
    <Frame title={fill(v.unitsIn, { project: v.demoProject })}>
      <div className={cn("grid gap-2", plan ? "grid-cols-3" : "grid-cols-2")}>
        {UNITS.map((unit) => {
          const isDemo = unit.code === "A-204";
          const status = isDemo ? demo.unitStatus : unit.status;
          const selected = isDemo && demo.unitSelected;
          return (
            <div key={unit.code} className={cn("rounded-lg border p-3 transition-colors", selected ? "border-accent bg-accent-soft" : "border-line bg-canvas", plan && "aspect-[4/3]")}>
              <p className="text-table font-semibold text-fg">{unit.code}</p>
              <div className="mt-1.5">{isDemo ? <StatusBadge status={status} v={v} /> : <Badge tone={statusTone[status]}>{v.status[status]}</Badge>}</div>
              {selected ? (
                <p className="mt-1.5 text-micro text-fg-muted">
                  {unit.area} m² · {fill(v.floor, { n: unit.floor })}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {!plan ? (
        <Button className="mt-4" size="sm" variant={demo.unitSelected ? "secondary" : "primary"} aria-pressed={demo.unitSelected} onClick={() => onDemo({ unitSelected: true })} data-testid="demo-select-unit">
          {demo.unitSelected ? `${v.selected}: A-204` : v.selectUnit}
        </Button>
      ) : (
        <Button className="mt-4" size="sm" disabled={demo.unitStatus !== "AVAILABLE"} onClick={() => onDemo({ unitSelected: true, unitStatus: "RESERVED" })} data-testid="demo-reserve-unit">
          {demo.unitStatus === "AVAILABLE" ? v.reserve : `A-204 · ${v.reserved}`}
        </Button>
      )}
    </Frame>
  );
}

/** The one Unit, accumulating what each department adds (§41). */
function UnitRecord({ slideId, demo, v }: { slideId: string; demo: DemoState; v: V }) {
  const legal = slideId === "legal" || slideId === "finance";
  const finance = slideId === "finance";
  return (
    <Frame title={`${v.unit} A-204 · ${v.demoProject}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-serif text-page leading-none text-fg">A-204</p>
        <StatusBadge status={demo.unitStatus} v={v} />
      </div>
      <p className="mt-1 text-table text-fg-muted">112 m² · {fill(v.floor, { n: 2 })}</p>
      <dl className="mt-4 space-y-3 border-t border-line pt-4 text-table" data-testid="demo-unit-record">
        <div>
          <dt className="nesto-eyebrow text-fg-subtle">{v.sales}</dt>
          <dd className="mt-1 flex flex-wrap gap-2"><Badge tone="success"><Check aria-hidden="true" className="size-3" />{v.buyer}: {v.buyerName}</Badge><Badge tone="success"><Check aria-hidden="true" className="size-3" />{v.reservation}</Badge></dd>
        </div>
        {legal ? (
          <div className="nesto-slide">
            <dt className="nesto-eyebrow text-fg-subtle">{v.legal}</dt>
            <dd className="mt-1 flex flex-wrap gap-2"><Badge tone="info">+ {v.reservationAgreement}</Badge><Badge tone="info">+ {v.saleContract}</Badge></dd>
          </div>
        ) : null}
        {finance ? (
          <div className="nesto-slide">
            <dt className="nesto-eyebrow text-fg-subtle">{v.finance}</dt>
            <dd className="mt-1"><Badge tone="info">+ {v.paymentLine} · 10%</Badge></dd>
          </div>
        ) : null}
      </dl>
      {finance ? (
        <p className="mt-4 border-t border-line pt-3 text-micro text-fg-muted">
          {[v.demoProject, `${v.unit} A-204`, v.buyer, v.contract, v.payments].join(" → ")}
        </p>
      ) : null}
    </Frame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-3">
      <p className="text-micro text-fg-muted">{label}</p>
      <p className="mt-1 font-serif text-section leading-none text-fg">{value}</p>
    </div>
  );
}

function Dashboard({ title, metrics }: { title: string; metrics: [string, string][] }) {
  return (
    <Frame title={title}>
      <div className="grid grid-cols-2 gap-2">
        {metrics.map(([label, value]) => <Metric key={label} label={label} value={value} />)}
      </div>
      <div aria-hidden="true" className="mt-4 flex h-16 items-end gap-1.5">
        {[40, 55, 48, 62, 70, 66, 78, 84].map((h, i) => <span key={i} className="flex-1 rounded-sm bg-accent-soft" style={{ height: `${h}%` }} />)}
      </div>
    </Frame>
  );
}

function Scope({ rows }: { rows: [string, boolean][] }) {
  return (
    <ul className="space-y-1.5">
      {rows.map(([label, ok]) => (
        <li key={label} className="flex items-center justify-between gap-3 rounded-md border border-line bg-canvas px-3 py-2 text-table">
          <span className={ok ? "text-fg" : "text-fg-subtle"}>{label}</span>
          {ok ? <Check aria-label="✓" className="size-4 text-success-strong" /> : <Minus aria-label="—" className="size-4 text-fg-subtle" />}
        </li>
      ))}
    </ul>
  );
}

export function StoryVisual({ visual, slideId, persona, demo, onDemo, v }: VisualProps) {
  const companyName = persona === "CONTRACTOR" ? v.demoContractor : v.demoCompany;
  const projectName = persona === "CONTRACTOR" ? v.demoContractorProject : v.demoProject;
  switch (visual) {
    case "companyTree":
      return <Frame title={companyName}><Tree root={`${v.company} · ${companyName}`} items={[v.departments, v.people, v.projects, v.permissions]} /></Frame>;
    case "projectCard":
      return (
        <Frame title={projectName}>
          <p className="text-micro text-fg-subtle">{companyName}</p>
          <p className="mt-1 font-serif text-section text-fg">{projectName}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {[v.team, v.documents, v.budget, v.permissions].map((item) => <div key={item} className="rounded-md border border-line bg-canvas px-3 py-2 text-table text-fg-muted">{item}</div>)}
          </div>
        </Frame>
      );
    case "unitGrid":
      return <UnitGrid demo={demo} onDemo={onDemo} v={v} />;
    case "rozarisPlan":
      return <UnitGrid demo={demo} onDemo={onDemo} v={v} plan />;
    case "unitRecord":
      return <UnitRecord slideId={slideId} demo={demo} v={v} />;
    case "developerDashboard":
      return <Dashboard title={`${v.dashboard} · ${v.demoCompany}`} metrics={[[v.unitsSold, "4 / 6"], [v.contractsSigned, "3"], [v.collected, "€ 184k"], [v.progress, "62%"]]} />;
    case "procurementFlow":
      return (
        <Frame title={`${v.material} · ${projectName}`}>
          <Flow steps={v.procurementSteps} doneThrough={demo.rfqApproved ? 4 : 1} />
          <Button className="mt-4" size="sm" disabled={demo.rfqApproved} onClick={() => onDemo({ rfqApproved: true })} data-testid="demo-approve-rfq">
            {demo.rfqApproved ? `${v.rfqApproved} · ${v.poCreated} ${v.poNumber}` : v.approveRfq}
          </Button>
        </Frame>
      );
    case "dailyLog":
      return <Frame title={`${v.dailyLog} · ${projectName}`}><ul className="space-y-1.5">{v.dailyLogItems.map((item) => <li key={item} className="rounded-md border border-line bg-canvas px-3 py-2 text-table text-fg">{item}</li>)}</ul></Frame>;
    case "qaFlow":
      return <Frame title={`QA/QC · ${projectName}`}><Flow steps={v.qaSteps} doneThrough={v.qaSteps.length - 1} /></Frame>;
    case "hseScope":
      return (
        <Frame title={`HSE · ${projectName}`}>
          <p className="nesto-eyebrow text-fg-subtle">{v.hseRoleSee}</p>
          <div className="mt-2"><Scope rows={v.hseItems.map((item) => [item, true])} /></div>
          <p className="nesto-eyebrow mt-4 text-fg-subtle">{v.hseRoleHidden}</p>
          <div className="mt-2"><Scope rows={v.hseItems.map((item, i) => [item, i === 1])} /></div>
        </Frame>
      );
    case "costChain":
      return (
        <Frame title={`${v.finance} · ${projectName}`}>
          <Flow steps={v.costChain.map((step, i) => (i === 0 ? `${step} ${v.poNumber}` : step))} doneThrough={demo.rfqApproved ? 3 : -1} />
        </Frame>
      );
    case "contractorDashboard":
      return <Dashboard title={`${v.dashboard} · ${projectName}`} metrics={[[v.procurementSteps[4], v.poNumber], [v.dailyLog, "38"], [v.qaSteps[1], "0"], [v.progress, "47%"]]} />;
    case "groupTree":
      return <Frame title={v.groupName}><Tree root={v.groupName} items={v.groupDepartments} /></Frame>;
    case "companiesTree":
      return <Frame title={v.groupName}><Tree root={v.groupName} items={v.companiesList} /></Frame>;
    case "departmentScope":
      return (
        <Frame title={v.groupFinance}>
          <Button size="sm" variant={demo.scopeShown ? "secondary" : "primary"} aria-pressed={demo.scopeShown} onClick={() => onDemo({ scopeShown: !demo.scopeShown })} data-testid="demo-toggle-scope">
            {demo.scopeShown ? v.hideScope : v.showScope}
          </Button>
          {demo.scopeShown ? (
            <div className="nesto-slide mt-4" data-testid="demo-scope">
              <Scope rows={[[v.companiesList[0], true], [v.companiesList[1], true], [v.companiesList[2], false], [v.projectX, true], [v.projectY, false]]} />
            </div>
          ) : null}
        </Frame>
      );
    case "projectGallery":
      return (
        <Frame title={`${v.projects} · ${v.groupName}`}>
          <div className="grid grid-cols-2 gap-2">
            {[[v.projectX, v.companiesList[0]], [v.projectY, v.companiesList[1]], [v.demoProject, v.companiesList[2]], ["Harbour Point", v.companiesList[3]]].map(([project, company]) => (
              <div key={project} className="rounded-lg border border-line bg-canvas p-3">
                <div aria-hidden="true" className="nesto-drafting-grid h-10 rounded-md border border-line" />
                <p className="mt-2 text-table font-medium text-fg">{project}</p>
                <p className="text-micro text-fg-muted">{company}</p>
              </div>
            ))}
          </div>
        </Frame>
      );
    case "personScope":
      return (
        <Frame title={`${v.maria} · ${v.mariaRole}`}>
          <p className="nesto-eyebrow text-fg-subtle">{v.access}</p>
          <div className="mt-2"><Scope rows={[[v.companiesList[0], true], [v.companiesList[1], true], [v.projectX, true], [v.companiesList[2], false]]} /></div>
        </Frame>
      );
    case "approvalFlow":
      return <Frame title={v.approvals}><Flow steps={v.approvalSteps} doneThrough={v.approvalSteps.length - 1} /></Frame>;
    case "groupControl":
      return (
        <div className="grid gap-3">
          <Dashboard title={v.ownerView} metrics={[[v.companiesList[0], "3"], [v.companiesList[1], "2"], [v.companiesList[2], "4"], [v.companiesList[3], "1"]]} />
          <Frame title={v.teamView}><Scope rows={[[v.projectX, true], [v.projectY, false]]} /></Frame>
        </div>
      );
    case "teamList":
      return <Frame title={`${v.team} · ${v.demoProject}`}><Scope rows={v.teamRoles.map((role) => [role, true])} /></Frame>;
    case "workList":
      return <Frame title={`${v.tasks} · ${v.demoProject}`}><Flow steps={[v.tasks, v.documents, v.dailyLog]} doneThrough={2} /></Frame>;
    case "approvalCard":
      return (
        <Frame title={v.approvals}>
          <p className="text-table text-fg">{v.procurementSteps[4]} {v.poNumber}</p>
          <p className="text-micro text-fg-muted">{v.demoProject} · {v.demoCompany}</p>
          <div className="mt-3"><Badge tone="warning">{v.pending}</Badge></div>
        </Frame>
      );
    case "managementDashboard":
      return <Dashboard title={v.dashboard} metrics={[[v.progress, "62%"], [v.approvals, "3"], [v.tasks, "41"], [v.budget, "94%"]]} />;
  }
}
