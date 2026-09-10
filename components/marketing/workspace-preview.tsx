import { Donut } from "@/components/charts/donut";
import { MiniBars } from "@/components/charts/mini-bars";
import { ProgressBar } from "@/components/charts/progress-bar";
import { NestoLogo } from "@/components/layout/nesto-logo";
import { getIcon } from "@/components/layout/nav-icon";
import { Badge } from "@/components/ui/badge";
import { demoProjects, statusLabels, statusTones } from "@/lib/marketing/preview-data";

/**
 * The product, on the public page (design spec §81).
 *
 * Not a screenshot. This is the application's own KPI card, progress bar,
 * donut, badge and demo records, rendered at marketing scale — so the preview
 * cannot go stale, weighs nothing, and is literally the interface rather than a
 * picture of it. It is exposed to assistive technology as a single image, since
 * nothing inside it is reachable or actionable.
 */

/**
 * The preview carries its own figures rather than the live KPI registry: this
 * is a marketing illustration, and it must not change shape when a real
 * dashboard KPI is added or renamed.
 */
type PreviewKpi = {
  key: string;
  label: string;
  value: string;
  icon: string;
  hint?: string;
  series?: number[];
};

const previewKpis: PreviewKpi[] = [
  {
    key: "active-projects",
    label: "Active projects",
    value: "12",
    icon: "FolderKanban",
    hint: "+2 this quarter",
    series: [6, 7, 7, 9, 10, 12],
  },
  {
    key: "contract-value",
    label: "Contracted value",
    value: "€24.6M",
    icon: "Wallet",
    hint: "+8.4% against plan",
    series: [14, 16, 18, 19, 22, 24.6],
  },
  {
    key: "open-ncrs",
    label: "Open NCRs",
    value: "3",
    icon: "ClipboardCheck",
    hint: "−4 since last month",
    series: [9, 8, 7, 6, 4, 3],
  },
  {
    key: "days-lost",
    label: "Days without incident",
    value: "184",
    icon: "ShieldCheck",
    hint: "Across every active site",
  },
];

function PreviewKpiCard({ kpi }: { kpi: PreviewKpi }) {
  const Icon = getIcon(kpi.icon);

  return (
    <div className="nesto-card p-3.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-strong"
        >
          <Icon className="size-3.5" />
        </span>
        <p className="min-w-0 truncate text-micro font-medium text-fg-muted">{kpi.label}</p>
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-2">
        <p className="text-section font-semibold tabular-nums text-fg">{kpi.value}</p>
        {kpi.series ? (
          <span className="hidden w-14 shrink-0 xl:block">
            <MiniBars points={kpi.series} caption={`${kpi.label} trend`} />
          </span>
        ) : null}
      </div>
      {kpi.hint ? <p className="mt-1 text-micro text-fg-subtle">{kpi.hint}</p> : null}
    </div>
  );
}

const previewNav = [
  { label: "Dashboard", icon: "LayoutDashboard", active: true },
  { label: "Projects", icon: "FolderKanban" },
  { label: "Tasks", icon: "CircleCheckBig" },
  { label: "Clients", icon: "Building2" },
  { label: "Documents", icon: "FileText" },
];

const previewDepartmentNav = [
  { label: "Finance", icon: "Wallet" },
  { label: "Procurement", icon: "ShoppingCart" },
  { label: "QA/QC", icon: "ClipboardCheck" },
  { label: "HSE", icon: "ShieldCheck" },
];

const previewProjects = demoProjects.slice(0, 4);

export function WorkspacePreview() {
  return (
    <div
      role="img"
      aria-label="The NESTO dashboard: role navigation on the left, four headline figures across the top, an active project table with progress against programme, and a breakdown of work by stage."
      className="nesto-card overflow-hidden"
    >
      {/* Top bar */}
      <div className="flex h-12 items-center gap-3 border-b border-line bg-surface px-4">
        <NestoLogo size="sm" showWordmark={false} />
        <div className="hidden h-7 w-56 items-center rounded-md border border-line bg-canvas px-2.5 lg:flex">
          <span className="text-micro text-fg-subtle">Search projects, people, documents</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="nesto-eyebrow hidden text-fg-subtle sm:block">CEO / Director</span>
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-full bg-graphite text-micro font-medium text-graphite-fg"
          >
            SA
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[168px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="hidden flex-col gap-1 border-r border-line bg-sidebar p-2.5 md:flex">
          {previewNav.map((item) => {
            const ItemIcon = getIcon(item.icon);
            return (
              <span
                key={item.label}
                className={[
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-table",
                  item.active ? "bg-accent-soft font-medium text-accent-strong" : "text-fg-muted",
                ].join(" ")}
              >
                <ItemIcon className="size-4 shrink-0" />
                {item.label}
              </span>
            );
          })}

          <p className="nesto-eyebrow mt-4 px-2.5 pb-1 text-fg-subtle">Department</p>
          {previewDepartmentNav.map((item) => {
            const ItemIcon = getIcon(item.icon);
            return (
              <span
                key={item.label}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-table text-fg-muted"
              >
                <ItemIcon className="size-4 shrink-0" />
                {item.label}
              </span>
            );
          })}
        </aside>

        {/* Content */}
        <div className="bg-canvas p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-serif text-section text-fg sm:text-page">Good morning, Sofia</h3>
              <p className="mt-1 text-table text-fg-muted">Company performance across 12 sites.</p>
            </div>
            <p className="nesto-eyebrow hidden text-fg-subtle sm:block">Monday · 14 Sep 2026</p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {previewKpis.map((kpi) => (
              <PreviewKpiCard key={kpi.key} kpi={kpi} />
            ))}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className="nesto-card overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5">
                <h4 className="text-table font-semibold text-fg">Active projects</h4>
                <span className="nesto-eyebrow text-fg-subtle">Progress</span>
              </div>
              <ul className="divide-y divide-line border-t border-line">
                {previewProjects.map((project) => (
                  <li key={project.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-table font-medium text-fg">{project.name}</p>
                      <p className="mt-0.5 truncate text-micro text-fg-subtle">
                        {project.code} · {project.client}
                      </p>
                    </div>
                    <Badge tone={statusTones[project.status]} className="hidden sm:inline-flex">
                      {statusLabels[project.status]}
                    </Badge>
                    <div className="hidden w-24 shrink-0 items-center gap-2 sm:flex">
                      <ProgressBar value={project.progress} label={`${project.name} progress`} />
                      <span className="w-8 shrink-0 text-right text-micro tabular-nums text-fg-muted">
                        {project.progress}%
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="nesto-card p-4">
              <h4 className="text-table font-semibold text-fg">Work by stage</h4>
              <div className="mt-4">
                <Donut
                  slices={[
                    { label: "Build", value: 6 },
                    { label: "Mobilise", value: 3 },
                    { label: "Tender", value: 2 },
                    { label: "Handover", value: 1 },
                  ]}
                  caption="Projects by stage"
                  centerValue="12"
                  centerLabel="Projects"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
