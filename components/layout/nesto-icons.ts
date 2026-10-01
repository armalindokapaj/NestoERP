import { createLucideIcon } from "lucide-react";

/**
 * The navigation icons drawn in the approved Black & Gold mockup, built from its
 * exact 24 × 24 paths so they behave like every other `LucideIcon`: sized with
 * `className`, weighted with `strokeWidth`, registered by name in `nav-icon.tsx`.
 */
const icon = (name: string, d: string) => createLucideIcon(name, [["path", { d, key: "d" }]]);

export const NestoOverview = icon("NestoOverview", "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 9h8V3h-8z");
export const NestoProjects = icon("NestoProjects", "M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6");
export const NestoProcurement = icon("NestoProcurement", "M4 4h16v4H4zM6 8v12h12V8M10 12h4");
export const NestoInventory = icon("NestoInventory", "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8");
export const NestoFinance = icon("NestoFinance", "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6");
export const NestoPeople = icon(
  "NestoPeople",
  "M16 21v-2a4 4 0 0 0-8 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M2 21v-2a4 4 0 0 1 3-3.9",
);
export const NestoApprovals = icon("NestoApprovals", "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9");
/** Registered for the audit log; no menu item uses it yet. */
export const NestoAuditLog = icon("NestoAuditLog", "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5");
