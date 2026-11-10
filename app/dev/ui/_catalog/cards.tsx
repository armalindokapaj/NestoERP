import { Building2, FileText, ImageOff, Lock, MoreHorizontal, TriangleAlert } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardControls, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CardLink } from "@/components/ui/card-link";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { MetricCell, MetricStrip } from "@/components/ui/metric-strip";
import { Skeleton } from "@/components/ui/skeleton";

import { CatalogEntry, SpecimenGroup } from "./frame";
import { Picture } from "./live";

/** A project card's 16:9 picture, or what stands in for one that is missing (UI-02 §11.1). */
function Thumbnail({ missing = false }: { missing?: boolean }) {
  return (
    <div className="grid aspect-video place-items-center rounded-t-[inherit] border-b border-line bg-surface-muted text-fg-subtle">
      {missing ? (
        <span className="flex flex-col items-center gap-1 text-meta"><ImageOff aria-hidden="true" className="size-6" />No image</span>
      ) : (
        <Building2 aria-hidden="true" className="size-6" />
      )}
    </div>
  );
}

function Facts({ items }: { items: Array<[label: string, value: string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-meta">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-fg-subtle">{label}</dt>
          <dd className="font-medium tabular-nums text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProjectMenu({ name }: { name: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="icon-sm" label={`Actions for ${name}`} icon={<MoreHorizontal aria-hidden="true" />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>Rename</DropdownMenuItem>
        <DropdownMenuItem>Archive</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CardEntry() {
  return (
    <CatalogEntry
      id="cards"
      title="Card"
      source="components/ui/card.tsx · card-link.tsx"
      summary="A border and a surface, not a shadow. Informational unless it says otherwise; a navigable card has one real link stretched over it, and its menu and checkbox sit above that link."
      notes={{
        props: "as (div, article, section, li), navigable, selected, disabled, loading, compact, status (success, warning, danger, info). Parts: CardHeader, CardTitle (as), CardDescription, CardContent, CardFooter, CardControls, CardLink (href).",
        role: "A div; article for a record in a gallery, li in a list, section for a titled panel. The control is the link inside.",
        keyboard: "Tab reaches the card's link, then its checkbox and menu, in that order. Enter opens the link; Space ticks the checkbox.",
        events: "None of its own: the link navigates, and the checkbox and the menu report to the caller. Nothing listens for a click on the card.",
        precedence: "Disabled blocks. Selected keeps its ring under hover. Focus on the link rings the whole card.",
        nesting: "Never a button inside an anchor: controls go in CardControls, beside the link, not within it.",
        responsive: "16px padding, 12px in compact density. It takes the width of its grid column; a title wraps to two lines and a footer is aligned by the layout, not by clipping text.",
        data: "The caller holds the record, the selection and what failed to load. A picture that does not load is the caller's to replace, as the broken-image card shows.",
        notApplicable: "Pressed (the link navigates), read-only (an archived card says so in a badge).",
        avoid: "Hover styling on a card that opens nothing, or a click handler on the card instead of a link.",
      }}
    >
      <SpecimenGroup title="Informational" hint="No pointer cursor, no hover styling. Only the controls inside take focus." className="grid gap-4 sm:grid-cols-2">
        <Card as="section" aria-labelledby="card-info-title">
          <CardHeader>
            <div className="min-w-0">
              <CardTitle id="card-info-title" as="h4">Retention</CardTitle>
              <CardDescription>Held until the defects period ends on 30 June 2027.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Facts items={[["Held", "€64,225"], ["Released", "€0"]]} />
          </CardContent>
          <CardFooter>
            <Button variant="secondary" size="sm">View schedule</Button>
          </CardFooter>
        </Card>
        <Card status="warning">
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4">Insurance expires soon</CardTitle>
              <CardDescription>The status rail repeats what the heading says; it never carries the meaning alone.</CardDescription>
            </div>
            <Badge tone="warning">12 days left</Badge>
          </CardHeader>
        </Card>
      </SpecimenGroup>

      <SpecimenGroup title="Navigable — project card" hint="Hover strengthens the border and shows a short gold rule; Tab to the title and the whole card is ringed. The menu and the checkbox do not open the project." className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card as="article" navigable data-testid="catalog-project-card">
          <Thumbnail />
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4"><CardLink href="#cards">Tirana Tower</CardLink></CardTitle>
              <CardDescription>Aurelia Construction · Tirana</CardDescription>
            </div>
            <CardControls>
              <Checkbox aria-label="Select Tirana Tower" />
              <ProjectMenu name="Tirana Tower" />
            </CardControls>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge tone="success">On track</Badge>
            <Facts items={[["Progress", "62%"], ["Open tasks", "17"]]} />
          </CardContent>
        </Card>
        <Card as="article" navigable selected>
          <Thumbnail missing />
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4"><CardLink href="#cards">Riverside Residences, Phase Two — Blocks C and D with the shared basement</CardLink></CardTitle>
              <CardDescription>Selected, missing image, long title</CardDescription>
            </div>
            <CardControls>
              <Checkbox aria-label="Select Riverside Residences, Phase Two" defaultChecked />
              <ProjectMenu name="Riverside Residences, Phase Two" />
            </CardControls>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge tone="warning">Attention</Badge>
            <Facts items={[["Progress", "38%"], ["Open tasks", "41"]]} />
          </CardContent>
        </Card>
        <Card as="article" navigable>
          <Thumbnail />
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4"><CardLink href="#cards">East Gate Logistics Hub</CardLink></CardTitle>
              <CardDescription>Archived: still opens, and says it is read-only</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge tone="neutral">Archived</Badge>
            <Facts items={[["Progress", "100%"], ["Open tasks", "0"]]} />
          </CardContent>
        </Card>
      </SpecimenGroup>

      <SpecimenGroup title="Other families and states" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card as="article" navigable>
          <CardHeader>
            <div className="flex min-w-0 items-start gap-3">
              <FileText aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
              <div className="min-w-0">
                <CardTitle as="h4"><CardLink href="#cards">A-201 Level 2 floor plan.pdf</CardLink></CardTitle>
                <CardDescription>Document card · revision C · updated 2 hours ago</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent><Badge tone="info">In review</Badge></CardContent>
        </Card>
        <Card as="article" navigable status="danger">
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4"><CardLink href="#cards">Respond to design RFI 014</CardLink></CardTitle>
              <CardDescription>Action card · Riverside Residences · assigned to Charles Morgan</CardDescription>
            </div>
            <Badge tone="danger">Overdue</Badge>
          </CardHeader>
        </Card>
        <Card as="article" navigable>
          <Picture alt="Harbour Offices, east elevation" />
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4"><CardLink href="#cards">Harbour Offices</CardLink></CardTitle>
              <CardDescription>Broken image: the file did not load, so the card keeps the picture&apos;s room and says so. The record still opens.</CardDescription>
            </div>
          </CardHeader>
          <CardContent><Facts items={[["Progress", "81%"], ["Open tasks", "6"]]} /></CardContent>
        </Card>
        <Card as="article" navigable>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4"><CardLink href="#cards">Lakeside Villas</CardLink></CardTitle>
              <CardDescription>Partial error: what loaded is shown, and the part that failed says so in words and offers the way to try again.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Facts items={[["Progress", "47%"], ["Open tasks", "—"]]} />
            <p className="flex items-start gap-2 text-meta text-warning-strong">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              Tasks could not be loaded.
            </p>
          </CardContent>
          <CardFooter>
            <CardControls>
              <Button variant="secondary" size="sm">Try again</Button>
            </CardControls>
          </CardFooter>
        </Card>
        <Card loading aria-label="Loading project">
          <Skeleton className="aspect-video rounded-none rounded-t-[inherit]" />
          <CardHeader>
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </CardHeader>
          <CardContent><Skeleton className="h-9 w-full" /></CardContent>
        </Card>
        <Card disabled>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4">Disabled</CardTitle>
              <CardDescription>Muted and inert: nothing inside it can be reached.</CardDescription>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex min-w-0 items-start gap-3">
              <Lock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
              <div className="min-w-0">
                <CardTitle as="h4">Payroll</CardTitle>
                <CardDescription>Permission unavailable: the card names the area and says why nothing is shown. You do not have access to payroll in this company.</CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>
        <Card compact>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle as="h4">Compact</CardTitle>
              <CardDescription>The card&apos;s own tighter padding, for a dense column.</CardDescription>
            </div>
          </CardHeader>
          <CardContent><Facts items={[["Units", "128"], ["Sold", "74"]]} /></CardContent>
        </Card>
      </SpecimenGroup>
    </CatalogEntry>
  );
}

export function MetricStripEntry() {
  return (
    <CatalogEntry
      id="metrics"
      title="MetricStrip"
      source="components/ui/metric-strip.tsx"
      summary="Figures read against each other: a label, the value in the metric size with tabular numerals, what it covers, and a comparison where a valid one exists. No icon tile and no coloured bar."
      notes={{
        props: "MetricStrip: the attributes of a dl. MetricCell: label, value, scope, comparison, comparisonTone (neutral, success, warning, danger), href, loading.",
        role: "A description list: each cell is a term and its value. A drill-down is a link on the label.",
        keyboard: "Only a cell with a destination takes focus; Enter opens the filtered list behind the figure.",
        events: "None: a cell with an href is a link, and navigates.",
        precedence: "A cell without a destination shows no action styling at all.",
        nesting: "Text and one link. No buttons, charts or menus inside a cell.",
        responsive: "The cells share a row and wrap to the next when they run out of room. The figure is 30/36, 26/32 in compact density; a long value wraps and is never clipped.",
        data: "The caller holds the figures, formats them, and decides whether a comparison is valid. A cell never computes one.",
        notApplicable: "Pressed, selected, disabled, read-only, error (a figure that failed to load says so in words).",
        avoid: "A link with no matching filtered list, or a comparison between periods that are not comparable.",
      }}
    >
      <SpecimenGroup title="Finance summary" hint="The third cell drills down: hover or Tab to it. The fourth is still loading and holds its room." className="block">
        <MetricStrip data-testid="catalog-metrics">
          <MetricCell label="Invoiced" value="€1,284,500" scope="This quarter" />
          <MetricCell label="Collected" value="€962,300" scope="This quarter" comparison="+8% on last quarter" comparisonTone="success" />
          <MetricCell label="Overdue invoices" value="14" scope="All companies" comparison="3 more than last week" comparisonTone="danger" href="#metrics" />
          <MetricCell label="Retention held" value="" scope="To date" loading />
        </MetricStrip>
      </SpecimenGroup>
      <SpecimenGroup title="Long values and no access" hint="A long amount wraps and is never clipped. A figure the reader may not see is a dash and a reason, not a zero." className="block">
        <MetricStrip>
          <MetricCell label="Contract value, all phases including approved variations" value="€128,450,275.50" scope="Riverside Residences" />
          <MetricCell label="Payroll" value="—" scope="No access in this company" />
          <MetricCell label="Open tasks" value="39" />
        </MetricStrip>
      </SpecimenGroup>
    </CatalogEntry>
  );
}
