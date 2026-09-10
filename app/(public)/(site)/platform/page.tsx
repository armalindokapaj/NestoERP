import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CtaBand } from "@/components/marketing/cta-band";
import { Lifecycle } from "@/components/marketing/lifecycle";
import { ModuleGrid } from "@/components/marketing/module-grid";
import { RoleGrid } from "@/components/marketing/role-grid";
import {
  PageIntro,
  Section,
  SectionHeader,
  hairlineCell,
  hairlineGrid,
} from "@/components/marketing/section";
import { StatStrip } from "@/components/marketing/stat-strip";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";
import { Button } from "@/components/ui/button";
import { pillars, rolesSection } from "@/config/marketing";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "Seventeen modules, sixteen role workspaces and one project record — the whole construction lifecycle in a single system.",
};

/**
 * The platform in full (design spec §82).
 *
 * The home page argues; this page shows. Modules, roles and lifecycle stages
 * are all rendered from the product's own configuration, so this page is a view
 * of NESTO rather than a description of it.
 */
export default function PlatformPage() {
  return (
    <>
      <PageIntro
        eyebrow="Platform"
        title="Everything a construction company runs, in one workspace."
        lead="One database, one design system and one set of permissions behind every department — from the tender that wins the job to the account that closes it."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/contact">
              Request access
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </PageIntro>

      <Section tone="canvas">
        <WorkspacePreview />
        <StatStrip className="mt-6" />
      </Section>

      <Section id="modules" tone="surface">
        <SectionHeader
          step="01"
          eyebrow="Modules"
          title="Seventeen modules, and the sections inside them."
          lead="Every module ships with its own route, header, navigation and dashboard. The tabs below are the ones your team will actually land on."
        />
        <ModuleGrid zones={["primary", "work", "department", "company"]} showTabs className="mt-14" />
      </Section>

      <Section id="roles" tone="canvas">
        <SectionHeader
          step="02"
          eyebrow={rolesSection.eyebrow}
          title={rolesSection.title}
          lead={rolesSection.lead}
        />
        <RoleGrid className="mt-12" />
        <p className="mt-6 max-w-2xl text-table leading-relaxed text-fg-subtle">
          A role is configuration, not a screen. Its navigation, dashboard and permissions are
          declared once, and it then appears in the sidebar, the roles settings and the access
          checks — so your own roles can be added without a line of interface being written.
        </p>
      </Section>

      <Section id="lifecycle" tone="surface">
        <SectionHeader
          step="03"
          eyebrow="The build"
          title="Six stages, one record."
          lead="Each stage names the modules it runs through, so the coverage can be checked rather than taken on trust."
        />
        <Lifecycle className="mt-12" />
      </Section>

      <Section tone="canvas" bordered={false}>
        <SectionHeader
          step="04"
          eyebrow="How it is built"
          title="The reasons it stays fast as it grows."
        />
        <div className={cn(hairlineGrid, "mt-12 lg:grid-cols-3")}>
          {pillars.map((pillar) => (
            <article key={pillar.title} className={cn(hairlineCell, "flex flex-col p-6 lg:p-8")}>
              <h3 className="text-card font-semibold text-fg">{pillar.title}</h3>
              <p className="mt-3 text-table leading-relaxed text-fg-muted">{pillar.copy}</p>
              <ul className="mt-6 space-y-2 border-t border-line pt-5 lg:mt-auto">
                {pillar.points.map((point) => (
                  <li key={point} className="nesto-eyebrow text-fg-subtle">
                    {point}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
