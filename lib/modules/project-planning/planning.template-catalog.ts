import type { MilestoneType } from "./planning.types";

/**
 * Planning templates (PRD #44 §133-§135, §140). Static and client-safe: a
 * starting structure, not a designer. Offsets are days from the project's
 * start, used for planned dates only when the project has a start date.
 */

export type TemplateMilestone = { key: string; name: string; type: MilestoneType; offsetDays?: number; critical?: boolean; committed?: boolean; after?: string[] };
export type PlanningTemplate = { key: string; name: string; description: string; phases: Array<{ name: string; milestones: TemplateMilestone[] }> };

export const PLANNING_TEMPLATES: readonly PlanningTemplate[] = [
  {
    key: "residential",
    name: "Residential Building",
    description: "Apartments or housing: from design freeze through structure, envelope and fit-out to handover.",
    phases: [
      { name: "Pre-Construction", milestones: [{ key: "mobilization", name: "Site Mobilization", type: "PROJECT_START", offsetDays: 14, committed: true }] },
      { name: "Design", milestones: [{ key: "design-freeze", name: "Design Freeze", type: "DESIGN", offsetDays: 45, critical: true }, { key: "permit", name: "Building Permit Approved", type: "APPROVAL", offsetDays: 60, critical: true, after: ["design-freeze"] }] },
      { name: "Procurement", milestones: [{ key: "packages", name: "Main Packages Awarded", type: "PROCUREMENT", offsetDays: 75, after: ["design-freeze"] }] },
      { name: "Substructure", milestones: [{ key: "foundations", name: "Foundation Complete", type: "CONSTRUCTION", offsetDays: 120, after: ["permit", "mobilization"] }] },
      { name: "Superstructure", milestones: [{ key: "structure", name: "Structure Complete", type: "CONSTRUCTION", offsetDays: 240, critical: true, after: ["foundations"] }] },
      { name: "Envelope", milestones: [{ key: "watertight", name: "Roof Watertight", type: "CONSTRUCTION", offsetDays: 270, after: ["structure"] }, { key: "facade", name: "Façade Complete", type: "CONSTRUCTION", offsetDays: 300, after: ["structure"] }] },
      { name: "MEP", milestones: [{ key: "first-fix", name: "MEP First Fix Complete", type: "CONSTRUCTION", offsetDays: 310, after: ["watertight"] }] },
      { name: "Fit-Out", milestones: [{ key: "fit-out", name: "Fit-Out Complete", type: "CONSTRUCTION", offsetDays: 380, after: ["first-fix"] }] },
      { name: "External Works", milestones: [{ key: "external", name: "External Works Complete", type: "CONSTRUCTION", offsetDays: 390, after: ["facade"] }] },
      { name: "Commissioning", milestones: [{ key: "commissioning", name: "Testing & Commissioning Complete", type: "COMMISSIONING", offsetDays: 405, after: ["fit-out"] }] },
      { name: "Handover", milestones: [{ key: "practical", name: "Practical Completion", type: "HANDOVER", offsetDays: 420, critical: true, committed: true, after: ["commissioning", "external"] }, { key: "handover", name: "Handover", type: "HANDOVER", offsetDays: 435, committed: true, after: ["practical"] }] },
    ],
  },
  {
    key: "commercial",
    name: "Commercial Building",
    description: "Offices or retail: design approvals, a long-lead procurement stage, core and shell, then tenant readiness.",
    phases: [
      { name: "Pre-Construction", milestones: [{ key: "contract", name: "Contract Signed", type: "CONTRACTUAL", offsetDays: 0, committed: true }, { key: "mobilization", name: "Site Mobilization", type: "PROJECT_START", offsetDays: 21, after: ["contract"] }] },
      { name: "Design", milestones: [{ key: "design-freeze", name: "Design Freeze", type: "DESIGN", offsetDays: 60, critical: true }] },
      { name: "Procurement", milestones: [{ key: "long-lead", name: "Long-Lead Equipment Ordered", type: "PROCUREMENT", offsetDays: 90, critical: true, after: ["design-freeze"] }] },
      { name: "Structure", milestones: [{ key: "core", name: "Core & Shell Complete", type: "CONSTRUCTION", offsetDays: 300, critical: true, after: ["mobilization"] }] },
      { name: "Envelope", milestones: [{ key: "envelope", name: "Building Envelope Closed", type: "CONSTRUCTION", offsetDays: 360, after: ["core"] }] },
      { name: "MEP", milestones: [{ key: "mep", name: "MEP Installation Complete", type: "CONSTRUCTION", offsetDays: 450, after: ["envelope", "long-lead"] }] },
      { name: "Commissioning", milestones: [{ key: "commissioning", name: "Systems Commissioned", type: "COMMISSIONING", offsetDays: 480, after: ["mep"] }, { key: "occupancy", name: "Occupancy Permit", type: "INSPECTION", offsetDays: 495, critical: true, after: ["commissioning"] }] },
      { name: "Handover", milestones: [{ key: "handover", name: "Handover to Client", type: "HANDOVER", offsetDays: 510, critical: true, committed: true, after: ["occupancy"] }] },
    ],
  },
  {
    key: "fit-out",
    name: "Fit-Out",
    description: "Interior works in an existing shell: survey, design sign-off, works, snagging and handover.",
    phases: [
      { name: "Survey & Design", milestones: [{ key: "survey", name: "Site Survey Complete", type: "PROJECT_START", offsetDays: 7 }, { key: "sign-off", name: "Client Design Sign-Off", type: "APPROVAL", offsetDays: 30, critical: true, after: ["survey"] }] },
      { name: "Procurement", milestones: [{ key: "materials", name: "Finishes Ordered", type: "PROCUREMENT", offsetDays: 40, after: ["sign-off"] }] },
      { name: "Works", milestones: [{ key: "partitions", name: "Partitions & Ceilings Complete", type: "CONSTRUCTION", offsetDays: 75, after: ["materials"] }, { key: "finishes", name: "Finishes Complete", type: "CONSTRUCTION", offsetDays: 100, after: ["partitions"] }] },
      { name: "Handover", milestones: [{ key: "snagging", name: "Snagging Closed", type: "INSPECTION", offsetDays: 110, after: ["finishes"] }, { key: "handover", name: "Handover", type: "HANDOVER", offsetDays: 115, critical: true, committed: true, after: ["snagging"] }] },
    ],
  },
  {
    key: "infrastructure",
    name: "Infrastructure",
    description: "Roads, utilities or civil works: permits and surveys, earthworks, structures and final inspection.",
    phases: [
      { name: "Permits & Surveys", milestones: [{ key: "permits", name: "Permits Granted", type: "APPROVAL", offsetDays: 45, critical: true }, { key: "survey", name: "Topographic Survey Complete", type: "DESIGN", offsetDays: 30 }] },
      { name: "Earthworks", milestones: [{ key: "earthworks", name: "Earthworks Complete", type: "CONSTRUCTION", offsetDays: 150, after: ["permits", "survey"] }] },
      { name: "Structures", milestones: [{ key: "structures", name: "Structures Complete", type: "CONSTRUCTION", offsetDays: 300, critical: true, after: ["earthworks"] }] },
      { name: "Utilities", milestones: [{ key: "utilities", name: "Utilities Connected", type: "COMMISSIONING", offsetDays: 330, after: ["structures"] }] },
      { name: "Completion", milestones: [{ key: "inspection", name: "Final Inspection Passed", type: "INSPECTION", offsetDays: 360, critical: true, after: ["utilities"] }, { key: "payment", name: "Final Payment Certificate", type: "PAYMENT", offsetDays: 390, committed: true, after: ["inspection"] }] },
    ],
  },
];
