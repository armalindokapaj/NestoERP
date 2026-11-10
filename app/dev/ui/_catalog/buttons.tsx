import { Bell, Download, MoreHorizontal, Plus, Settings, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

import { CatalogEntry, Specimen, SpecimenGroup } from "./frame";
import { BusyButton, PressedDemo, SaveDemo } from "./live";

const VARIANTS = [
  { variant: "primary", label: "Create project", use: "The one main action of a task area." },
  { variant: "secondary", label: "Export", use: "A defined action beside the main one." },
  { variant: "ghost", label: "Cancel", use: "Tertiary: text until it is hovered." },
  { variant: "subtle", label: "Filters", use: "A quiet filled action inside a toolbar." },
  { variant: "danger", label: "Delete invoice", use: "Destructive, and says so in its label." },
  { variant: "accent", label: "Create", use: "Gold in version 1; the primary button in version 2." },
  { variant: "link", label: "View all tasks", use: "An action that reads as a text link." },
] as const;

export function ButtonEntry() {
  return (
    <CatalogEntry
      id="buttons"
      title="Button"
      source="components/ui/button.tsx"
      summary="One visually primary action per task area, named with a verb. Hover is a small shift in contrast, pressed is immediate, and nothing lifts or moves."
      notes={{
        props: "variant (primary, secondary, ghost, subtle, danger, accent, link), size (sm, md, lg, icon, icon-sm), loading, asChild, and every attribute of a native button.",
        role: "A native button; with asChild, the anchor it wraps.",
        keyboard: "Tab to it; Enter or Space activates. A busy button keeps focus and ignores both.",
        events: "onClick, once per activation. While loading it is not called at all: the click is refused before it reaches the caller, and so is a form's implicit submit.",
        precedence: "Disabled blocks everything. Busy blocks a second activation. Focus is always drawn, 2px ring at 2px offset.",
        nesting: "Text and one icon: 20px, 16px in the small size and in compact density. Never inside an anchor, never around another control.",
        responsive: "40px high, 32px in compact density, 44px and at least 44px wide under touch whatever the preference. It never wraps its label.",
        data: "None of its own. The caller holds loading and disabled, and puts the result of the action beside the button, not in it.",
        notApplicable: "Selected, read-only, error, empty. A failed action restores the button; the message belongs beside it.",
        avoid: "A primary button in every row, or a label such as Continue on a step that changes data.",
      }}
    >
      {VARIANTS.map(({ variant, label, use }) => (
        <SpecimenGroup key={variant} title={variant} hint={use} className="grid grid-cols-2 sm:grid-cols-4">
          <Specimen label="Default — hover, press, Tab">
            <Button variant={variant}>{label}</Button>
          </Specimen>
          <Specimen label="With icon">
            <Button variant={variant}>
              {variant === "danger" ? <Trash2 aria-hidden="true" /> : <Plus aria-hidden="true" />}
              {label}
            </Button>
          </Specimen>
          <Specimen label="Disabled">
            <Button variant={variant} disabled>{label}</Button>
          </Specimen>
          <Specimen label="Loading">
            <BusyButton variant={variant}>{label}</BusyButton>
          </Specimen>
        </SpecimenGroup>
      ))}

      <SpecimenGroup title="Sizes" hint="The middle size is the control height of the density: 40px, 32px compact, 44px under touch.">
        <Specimen label="sm"><Button size="sm" variant="secondary">Export</Button></Specimen>
        <Specimen label="md"><Button size="md" variant="secondary">Export</Button></Specimen>
        <Specimen label="lg"><Button size="lg" variant="secondary">Export</Button></Specimen>
        <Specimen label="As a link (asChild)">
          <Button asChild variant="secondary">
            <a href="#buttons"><Download aria-hidden="true" />Download report</a>
          </Button>
        </Specimen>
      </SpecimenGroup>

      <SpecimenGroup title="Long label" hint="A button does not wrap or clip its label; the layout around it gives way.">
        <Specimen label="Long text" className="max-w-full overflow-x-auto">
          <Button variant="secondary">Submit the revised structural drawings for consultant review</Button>
        </Specimen>
      </SpecimenGroup>

      <SpecimenGroup title="Busy, live" hint="Activate it, then press Enter again while it works: one save, the same width, focus stays on the button.">
        <SaveDemo />
      </SpecimenGroup>
    </CatalogEntry>
  );
}

export function IconButtonEntry() {
  return (
    <CatalogEntry
      id="icon-buttons"
      title="IconButton"
      source="components/ui/icon-button.tsx"
      summary="An icon-only control. Its label is required, so it always has an accessible name, and in version 2 the same label is its tooltip on hover and on keyboard focus. Hover is a neutral ground with no colour of its own."
      notes={{
        props: "label (required: the name and the tooltip), icon, size (icon, icon-sm), variant, pressed, and every attribute of a native button but children and aria-label.",
        role: "A native button; a toggle sets aria-pressed. The tooltip is for the eye and is hidden from assistive technology, which already has the label.",
        keyboard: "Tab to it: the tooltip shows at once. Enter or Space activates or toggles; Escape closes the tooltip.",
        events: "onClick. A toggle's caller flips pressed in it; the button does not toggle itself.",
        precedence: "Disabled blocks, and shows no tooltip. Pressed keeps its ring under hover. Focus is always drawn.",
        nesting: "One icon. Sits above a navigable card's link, never inside the link.",
        responsive: "40px square, 32px in compact density (28px for icon-sm), 44px under touch. No tooltip on touch, where nothing hovers: the action must be conventional or labelled nearby.",
        data: "None of its own. The caller holds pressed.",
        notApplicable: "Loading, read-only, error, empty, long text.",
        avoid: "An icon whose meaning is not conventional, without visible text nearby.",
      }}
    >
      <SpecimenGroup title="Sizes and variants" hint="At least 24×24 in compact density, 44×44 under touch whatever the preference.">
        <Specimen label="icon — ghost · hover or Tab for the tooltip"><IconButton label="Notifications" icon={<Bell aria-hidden="true" />} /></Specimen>
        <Specimen label="icon-sm — ghost"><IconButton size="icon-sm" label="Row actions" icon={<MoreHorizontal aria-hidden="true" />} /></Specimen>
        <Specimen label="icon — secondary"><IconButton variant="secondary" label="Settings" icon={<Settings aria-hidden="true" />} /></Specimen>
        <Specimen label="Disabled"><IconButton disabled label="Settings unavailable" icon={<Settings aria-hidden="true" />} /></Specimen>
      </SpecimenGroup>
      <SpecimenGroup title="Pressed, live" hint="The first starts pressed. The state is a fill and a ring, not colour alone.">
        <PressedDemo />
      </SpecimenGroup>
    </CatalogEntry>
  );
}
