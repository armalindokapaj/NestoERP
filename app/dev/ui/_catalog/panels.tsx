"use client";

import { FileText } from "@/components/icons";

import { ProgressBar } from "@/components/charts/progress-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeaderFrame, SectionHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CatalogEntry, Specimen, SpecimenGroup } from "./frame";

/**
 * The pieces a module page is built from, around its records: the page's head,
 * a titled panel, tabs, a switch, a progress bar and the empty state — the
 * square drawing set of UI-05 §9 (docs/ui/UI-07-unified-design.md).
 */
export function PanelEntry() {
  return (
    <CatalogEntry
      id="panels"
      title="Page and panels"
      source="components/ui/page-header.tsx, card.tsx, tabs.tsx, switch.tsx, empty-state.tsx"
      summary="A module page in the drawing set: the title in the display face ending on the gold square over an ink rule, panels as square cells in 1px lines, their heads in mono capitals, every control square."
      notes={{
        props: "As each primitive's own entry and source.",
        role: "A header, sections with h2 heads, a tablist, a switch, a progressbar, a status message.",
        keyboard: "Tabs move with the arrow keys; the switch toggles with Space.",
        events: "As each primitive.",
        precedence: "As each primitive.",
        nesting: "A panel's head names the section, never a record: a record's name keeps its own face.",
        responsive: "Panels stack below md; the header's actions wrap under the title.",
        data: "The page holds its data; the pieces hold none.",
        notApplicable: "—",
        avoid: "Rounded corners, shadows on anything that does not float, a gap where two panels could share a line.",
      }}
    >
      <SpecimenGroup title="Page head" className="block">
        <PageHeaderFrame kind="module" title="Purchase orders" subtitle="Every order across the projects, with what is still to arrive." actions={<Button>New order</Button>} />
      </SpecimenGroup>
      <SpecimenGroup title="Panels" className="grid w-full gap-0 md:grid-cols-2">
        <section className="nesto-card -mb-px md:-mr-px">
          <div className="border-b border-line px-(--nesto-space-card) py-3">
            <h2 className="nesto-section-head">Budget</h2>
          </div>
          <div className="space-y-3 p-(--nesto-space-card)">
            <p className="text-table text-fg-muted">Committed 62% of the approved budget.</p>
            <ProgressBar value={62} label="Committed" />
          </div>
        </section>
        <section className="nesto-card -mb-px">
          <div className="border-b border-line px-(--nesto-space-card) py-3">
            <SectionHeader title="Notifications" description="What reaches you by email." />
          </div>
          <div className="flex items-center justify-between gap-3 p-(--nesto-space-card)">
            <span className="text-table text-fg">Daily summary</span>
            <Switch defaultChecked aria-label="Daily summary" />
          </div>
        </section>
      </SpecimenGroup>
      <SpecimenGroup title="Tabs">
        <Specimen label="Segmented, square">
          <Tabs defaultValue="open">
            <TabsList>
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="closed">Closed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
            <TabsContent value="open" />
          </Tabs>
        </Specimen>
      </SpecimenGroup>
      <SpecimenGroup title="Empty" className="block">
        <EmptyState icon={<FileText />} title="No documents yet" description="Drawings, contracts and photos filed on this project appear here." />
      </SpecimenGroup>
    </CatalogEntry>
  );
}
