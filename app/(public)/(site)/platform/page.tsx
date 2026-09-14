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
import { getSiteCopy } from "@/lib/i18n/server";
import { cn } from "@/lib/utils/cn";

export async function generateMetadata(): Promise<Metadata> {
  return (await getSiteCopy()).meta.platform;
}

/**
 * The platform in full (design spec §82).
 *
 * The home page argues; this page shows. Modules, roles and lifecycle stages
 * are all rendered from the product's own configuration, so this page is a view
 * of NESTO rather than a description of it.
 */
export default async function PlatformPage() {
  const { platform, rolesSection, pillars } = await getSiteCopy();

  return (
    <>
      <PageIntro eyebrow={platform.eyebrow} title={platform.title} lead={platform.lead}>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/contact">
              {platform.requestAccess}
              <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/pricing">{platform.seePricing}</Link>
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
          eyebrow={platform.modules.eyebrow}
          title={platform.modules.title}
          lead={platform.modules.lead}
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
          {platform.rolesNote}
        </p>
      </Section>

      <Section id="lifecycle" tone="surface">
        <SectionHeader
          step="03"
          eyebrow={platform.build.eyebrow}
          title={platform.build.title}
          lead={platform.build.lead}
        />
        <Lifecycle className="mt-12" />
      </Section>

      <Section tone="canvas" bordered={false}>
        <SectionHeader
          step="04"
          eyebrow={platform.howItIsBuilt.eyebrow}
          title={platform.howItIsBuilt.title}
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
