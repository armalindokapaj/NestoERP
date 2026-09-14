import {
  DELAY_CATEGORIES,
  DELAY_CATEGORY_LABELS,
  DELAY_IMPACTS,
  DELAY_IMPACT_LABELS,
  EQUIPMENT_STATUSES,
  EQUIPMENT_STATUS_LABELS,
  WEATHER_CONDITIONS,
  WEATHER_CONDITION_LABELS,
  type DailyLogDetailDTO,
  type SectionKey,
} from "@/lib/modules/daily-logs/daily-log.types";

/**
 * The fields of each section form (PRD #43 §21-§61). One description drives the
 * add and edit dialog for every section, so each section reads and behaves the
 * same, and what goes to the server is exactly what the schema expects.
 */

export type OptionSource = "suppliers" | "purchaseOrders" | "goodsReceipts" | "inventoryReceipts" | "tasks" | "members";

export type FieldDef = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "integer" | "time" | "date" | "select" | "checkbox" | "option";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  source?: OptionSource;
  min?: number;
  max?: number;
  step?: string;
  /** Takes the full row on a wide dialog. */
  wide?: boolean;
};

const choose = <T extends string>(values: readonly T[], labels: Record<T, string>) => values.map((value) => ({ value, label: labels[value] }));

export const SECTION_FIELDS: Record<SectionKey, FieldDef[]> = {
  weather: [
    { name: "observedTime", label: "Observed at", type: "time", required: true },
    { name: "condition", label: "Condition", type: "select", options: choose(WEATHER_CONDITIONS, WEATHER_CONDITION_LABELS) },
    { name: "temperatureC", label: "Temperature (°C)", type: "number", min: -60, max: 70, step: "0.1" },
    { name: "precipitationMm", label: "Rain (mm)", type: "number", min: 0, step: "0.1" },
    { name: "windKph", label: "Wind (km/h)", type: "number", min: 0, step: "0.1" },
    { name: "humidityPct", label: "Humidity (%)", type: "integer", min: 0, max: 100 },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  workforce: [
    { name: "organizationName", label: "Company or crew", type: "text", required: true, placeholder: "Alba Concrete", wide: true },
    { name: "supplierId", label: "Known supplier", type: "option", source: "suppliers", hint: "Link the supplier record when there is one." },
    { name: "trade", label: "Trade", type: "text", placeholder: "Concrete" },
    { name: "crewName", label: "Crew", type: "text" },
    { name: "headcount", label: "Headcount", type: "integer", required: true, min: 1, max: 10000 },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  activities: [
    { name: "title", label: "Work done", type: "text", required: true, placeholder: "Level 3 slab pour", wide: true },
    { name: "projectArea", label: "Area", type: "text", placeholder: "Block B" },
    { name: "floorZone", label: "Floor or zone", type: "text", placeholder: "Level 3" },
    { name: "trade", label: "Trade", type: "text" },
    { name: "progressPercent", label: "Progress today (%)", type: "number", min: 0, max: 100, step: "1", hint: "This activity's observed progress. Milestones are not changed." },
    { name: "linkedTaskId", label: "Task", type: "option", source: "tasks", wide: true },
    { name: "description", label: "Description", type: "textarea", wide: true },
  ],
  equipment: [
    { name: "equipmentName", label: "Equipment", type: "text", required: true, placeholder: "Tower crane", wide: true },
    { name: "equipmentCode", label: "Code", type: "text" },
    { name: "supplierId", label: "Supplier", type: "option", source: "suppliers" },
    { name: "quantity", label: "Quantity", type: "integer", required: true, min: 1 },
    { name: "hoursUsed", label: "Hours used", type: "number", min: 0, step: "0.5" },
    { name: "status", label: "Status", type: "select", options: choose(EQUIPMENT_STATUSES, EQUIPMENT_STATUS_LABELS) },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  deliveries: [
    { name: "description", label: "What arrived", type: "text", required: true, placeholder: "Rebar bundles", wide: true },
    { name: "supplierId", label: "Supplier", type: "option", source: "suppliers" },
    { name: "quantityText", label: "Quantity", type: "text", placeholder: "8.4 t" },
    { name: "purchaseOrderId", label: "Purchase order", type: "option", source: "purchaseOrders" },
    { name: "goodsReceiptId", label: "Goods receipt", type: "option", source: "goodsReceipts" },
    { name: "inventoryReceiptId", label: "Inventory receipt", type: "option", source: "inventoryReceipts" },
    { name: "deliveredTime", label: "Arrived at", type: "time" },
    { name: "deliveredDate", label: "Arrived on", type: "date", hint: "Leave empty for the log's day." },
    { name: "conditionNote", label: "Condition on arrival", type: "textarea", wide: true },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  visitors: [
    { name: "name", label: "Name", type: "text", required: true, hint: "Only what the record needs.", wide: true },
    { name: "organization", label: "Organisation", type: "text" },
    { name: "purpose", label: "Purpose", type: "text" },
    { name: "arrivedTime", label: "Arrived", type: "time" },
    { name: "departedTime", label: "Left", type: "time" },
    { name: "escortedByMemberId", label: "Escorted by", type: "option", source: "members" },
    { name: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  delays: [
    { name: "title", label: "What held work up", type: "text", required: true, placeholder: "Rain stopped external works", wide: true },
    { name: "category", label: "Category", type: "select", required: true, options: choose(DELAY_CATEGORIES, DELAY_CATEGORY_LABELS) },
    { name: "impact", label: "Impact", type: "select", options: choose(DELAY_IMPACTS, DELAY_IMPACT_LABELS) },
    { name: "startedTime", label: "From", type: "time" },
    { name: "endedTime", label: "To", type: "time" },
    { name: "durationMinutes", label: "Duration (minutes)", type: "integer", min: 1, max: 1440, hint: "Worked out from the times when both are given." },
    { name: "responsiblePartyText", label: "Cause attributed to", type: "text", hint: "An observation, not a claim." },
    { name: "linkedTaskId", label: "Task", type: "option", source: "tasks", wide: true },
    { name: "description", label: "Description", type: "textarea", wide: true },
  ],
  instructions: [
    { name: "title", label: "Instruction", type: "text", required: true, wide: true },
    { name: "description", label: "What was instructed", type: "textarea", required: true, wide: true },
    { name: "issuedByText", label: "Issued by", type: "text", placeholder: "Lead Architect" },
    { name: "issuedByMemberId", label: "Issued by (member)", type: "option", source: "members" },
    { name: "recipientText", label: "Given to", type: "text" },
    { name: "issuedTime", label: "Issued at", type: "time" },
    { name: "requiresAction", label: "Requires action", type: "checkbox" },
    { name: "linkedTaskId", label: "Task", type: "option", source: "tasks", wide: true },
  ],
};

export const SECTION_NOUNS: Record<SectionKey, string> = {
  weather: "weather reading",
  workforce: "workforce entry",
  activities: "work activity",
  equipment: "equipment",
  deliveries: "delivery",
  visitors: "visitor",
  delays: "delay",
  instructions: "instruction",
};

type Entry = Record<string, unknown> & { id: string; updatedAt: string };

/** The form values an existing entry starts from. */
export function valuesFromEntry(section: SectionKey, entry: Entry): Record<string, unknown> {
  const ref = (key: string) => ((entry[key] as { id?: string } | null)?.id ?? "");
  const person = (key: string) => ((entry[key] as { memberId?: string } | null)?.memberId ?? "");
  switch (section) {
    case "weather":
      return { ...entry, observedTime: entry.observedAt };
    case "workforce":
    case "equipment":
      return { ...entry, supplierId: ref("supplier") };
    case "activities":
      return { ...entry, linkedTaskId: ref("task") };
    case "deliveries":
      return { ...entry, supplierId: ref("supplier"), purchaseOrderId: ref("purchaseOrder"), goodsReceiptId: ref("goodsReceipt"), inventoryReceiptId: ref("inventoryReceipt"), deliveredTime: entry.deliveredTime ?? "", deliveredDate: entry.outsideWorkDate ? (entry.deliveredDate ?? "") : "" };
    case "visitors":
      return { ...entry, arrivedTime: entry.arrivedAt ?? "", departedTime: entry.departedAt ?? "", escortedByMemberId: person("escortedBy") };
    case "delays":
      return { ...entry, startedTime: entry.startedAt ?? "", endedTime: entry.endedAt ?? "", linkedTaskId: ref("task") };
    case "instructions":
      return { ...entry, issuedTime: entry.issuedAt ?? "", issuedByMemberId: person("issuedBy"), linkedTaskId: ref("task") };
  }
}

/** Form values as the API takes them: empty strings become null, numbers become numbers. */
export function payloadFromValues(section: SectionKey, values: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of SECTION_FIELDS[section]) {
    const raw = values[field.name];
    if (field.type === "checkbox") payload[field.name] = Boolean(raw);
    else if (field.type === "number" || field.type === "integer") payload[field.name] = raw === "" || raw === null || raw === undefined ? null : Number(raw);
    else payload[field.name] = raw === "" || raw === undefined ? null : raw;
  }
  return payload;
}

export function entriesOf(log: DailyLogDetailDTO, section: SectionKey): Entry[] {
  return log[section] as unknown as Entry[];
}
