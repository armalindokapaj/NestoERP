/** Prints the transition tables for docs/state-machines.md (PRD #49 §156, §294). */
import { permissionsOf, targetsOf } from "../../lib/core/state/machine";
import { STATE_MACHINES } from "../../lib/core/state/registry";
import { MODEL_OWNER } from "./ownership";

const code = (value: string) => `\`${value}\``;

/** How each owning domain is headed in the document — the module's name as people use it. */
const HEADING: Record<string, string> = {
  hse: "HSE",
  qaqc: "QA/QC",
  documents: "Documents",
  finance: "Finance",
  procurement: "Procurement",
  inventory: "Inventory",
  contracts: "Legal",
  engineering: "Engineering",
  projects: "Projects",
  "project-structure": "Project structure",
};

let domain = "";
for (const machine of STATE_MACHINES) {
  const owner = MODEL_OWNER[machine.model];
  if (owner !== domain) {
    domain = owner;
    const count = STATE_MACHINES.filter((candidate) => MODEL_OWNER[candidate.model] === owner).length;
    console.log(`### ${HEADING[owner] ?? owner}\n`);
    console.log(`${count} ${count === 1 ? "machine" : "machines"}.\n`);
  }
  console.log(`#### ${code(machine.key)} — ${code(`${machine.model}.${machine.field}`)}\n`);
  console.log(`States: ${machine.states.map(code).join(", ")}`);
  console.log(`Terminal: ${machine.terminal.length ? machine.terminal.map(code).join(", ") : "none"}\n`);
  console.log("| Action | From | To | Permission | Reason | Freezes |");
  console.log("|---|---|---|---|---|---|");
  for (const t of machine.transitions) {
    const permission = permissionsOf(t).map(code).join(" or ") + (t.concludedByApprovalStep ? ", or the approval step's approver" : "");
    const to = targetsOf(t).map(code).join(" or ");
    console.log(
      `| ${code(t.action)} | ${t.from.map(code).join(", ")} | ${to} | ${permission} | ${t.requiresReason ? "required" : "—"} | ${t.freezes ?? "—"} |`,
    );
  }
  console.log();
}
