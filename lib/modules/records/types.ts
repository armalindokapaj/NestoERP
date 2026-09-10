import type { ModuleKey } from "@/config/modules";
import type { Permission } from "@/config/permissions";
import type { UserContext } from "@/lib/context/types";
import type { FilterConfig } from "@/components/data/list-toolbar";

/**
 * One generic record shape for every department module (PRD #7 §93).
 *
 * Finance, HR, Sales, Legal, Procurement, Inventory, QA/QC, HSE and Support all
 * describe their sections through this registry instead of building their own
 * tables, detail pages, filters and empty states. The business content changes;
 * the interaction architecture does not (PRD #7 §162).
 */

export type RecordField = {
  key: string;
  label: string;
  value: string;
  /** Hidden below this breakpoint in the desktop table. */
  hideBelow?: "md" | "lg" | "xl";
  align?: "left" | "right";
  /** Rendered as a status badge rather than plain text. */
  status?: boolean;
};

export type ModuleRecordRow = {
  id: string;
  primary: string;
  secondary?: string;
  status?: string;
  fields: RecordField[];
};

export type ModuleRecordDetail = {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  description?: string | null;
  fields: { label: string; value: string }[];
  /** Created / updated / approved metadata (PRD #7 §35). */
  meta: { label: string; value: string }[];
  /** Present when the record participates in the approval shell (PRD #7 §50). */
  approval?: { status: string; pending: boolean };
};

export type ListResult = {
  rows: ModuleRecordRow[];
  total: number;
};

export type ListArgs = {
  search?: string;
  filters: Record<string, string>;
  page: number;
  limit: number;
};

export type RecordSection = {
  module: ModuleKey;
  /** Matches a `ModuleSectionConfig.key` in config/modules.ts. */
  section: string;
  /** "Invoice", "Leave request" — used in empty states and page copy. */
  singular: string;
  plural: string;
  emptyTitle: string;
  emptyDescription: string;
  permission: Permission;
  approvePermission?: Permission;
  /** Column order for the list. `primary` is the row title. */
  columns: { key: string; label: string; hideBelow?: "md" | "lg" | "xl"; align?: "left" | "right" }[];
  filters?: FilterConfig[];
  list(context: UserContext, args: ListArgs): Promise<ListResult>;
  get(context: UserContext, id: string): Promise<ModuleRecordDetail | null>;
  /** Applies an approval decision. Present only on approvable sections. */
  decide?(context: UserContext, id: string, decision: "APPROVE" | "REJECT"): Promise<void>;
};
