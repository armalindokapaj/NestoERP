import { AlertTriangle, Check, Clock, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";

import { CatalogEntry, Specimen, SpecimenGroup } from "./frame";
import { RemovableTags } from "./live";

export function BadgeEntry() {
  return (
    <CatalogEntry
      id="badges"
      title="Badge"
      source="components/ui/badge.tsx"
      summary="A status: a label, and an icon where it means something. The domain state picks the tone, never the other way round, and the label carries the state on its own."
      notes={{
        props: "tone (default, neutral, info, success, warning, danger), icon, wrap, and every attribute of a span.",
        role: "A span of text. Not a control.",
        keyboard: "None: it takes no focus.",
        events: "None.",
        precedence: "None: it has one state, the one the record is in.",
        nesting: "A label and an optional 12px icon. Inside table cells, card footers and headings.",
        responsive: "One line; with wrap it breaks inside a narrow column. The same size in every density and under touch.",
        data: "The caller maps the record's state to a tone and a label. The badge holds neither and decides neither.",
        notApplicable: "Hover, focus, pressed, selected, disabled, loading, read-only, error.",
        avoid: "Colour without a label, or a decorative badge for a state the data does not hold.",
      }}
    >
      <SpecimenGroup title="Tones" hint="Draft, archived and cancelled are neutral; in review is informational; the rest say how it went.">
        <Specimen label="default"><Badge>Draft</Badge></Specimen>
        <Specimen label="neutral"><Badge tone="neutral">Archived</Badge></Specimen>
        <Specimen label="info"><Badge tone="info">In review</Badge></Specimen>
        <Specimen label="success"><Badge tone="success">Approved</Badge></Specimen>
        <Specimen label="warning"><Badge tone="warning">Overdue</Badge></Specimen>
        <Specimen label="danger"><Badge tone="danger">Rejected</Badge></Specimen>
      </SpecimenGroup>
      <SpecimenGroup title="With an icon">
        <Specimen label="info"><Badge tone="info" icon={<Clock />}>In review</Badge></Specimen>
        <Specimen label="success"><Badge tone="success" icon={<Check />}>Approved</Badge></Specimen>
        <Specimen label="warning"><Badge tone="warning" icon={<AlertTriangle />}>Overdue by 4 days</Badge></Specimen>
        <Specimen label="danger"><Badge tone="danger" icon={<X />}>Rejected</Badge></Specimen>
      </SpecimenGroup>
      <SpecimenGroup title="Long label" hint="One line by default; wrap lets a long status break inside a narrow column instead of overflowing it.">
        <Specimen label="One line">
          <Badge tone="warning">Awaiting the consultant&apos;s second review</Badge>
        </Specimen>
        <Specimen label="wrap, in 12rem" className="w-48">
          <Badge tone="warning" wrap>Awaiting the consultant&apos;s second review</Badge>
        </Specimen>
      </SpecimenGroup>
    </CatalogEntry>
  );
}

export function TagEntry() {
  return (
    <CatalogEntry
      id="tags"
      title="Tag"
      source="components/ui/tag.tsx"
      summary="A plain label for a category or an applied filter, with the small radius. It does nothing unless its removal is explicit."
      notes={{
        props: "children (the label), onRemove, removeLabel (the remove button's name, required with onRemove), and every attribute of a span.",
        role: "A span of text; a removable tag adds a native button named after it.",
        keyboard: "Only the remove button takes focus; Enter or Space removes.",
        events: "onRemove, when the remove button is activated. The tag does not remove itself.",
        precedence: "None for the label. The remove button follows the button contract.",
        nesting: "Text. Lists of tags are lists.",
        responsive: "A long label wraps inside its column. The remove button is a 24px target, 44px under touch.",
        data: "The caller holds the list of tags and where focus goes when one is removed.",
        notApplicable: "Selected, loading, read-only, error. A tag that filters on click is a button, not this.",
        avoid: "A status. Colour that implies a meaning the tag does not have.",
      }}
    >
      <SpecimenGroup title="Plain">
        <Specimen label="Default"><Tag>Structural</Tag></Specimen>
        <Specimen label="Long, in 12rem" className="w-48"><Tag>Mechanical, electrical and plumbing coordination</Tag></Specimen>
      </SpecimenGroup>
      <SpecimenGroup title="Removable, live" hint="Each button is named “Remove …” after its tag; focus moves to a neighbour when one goes.">
        <RemovableTags />
      </SpecimenGroup>
    </CatalogEntry>
  );
}
