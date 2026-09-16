/** Prints the transition tables for docs/state-machines.md (PRD #49 §156, §294). */
import { STATE_MACHINES } from "../../lib/core/state/registry";

for (const machine of STATE_MACHINES) {
  console.log(`### \`${machine.key}\` — \`${machine.model}.${machine.field}\`\n`);
  console.log(`States: ${machine.states.map((s) => `\`${s}\``).join(", ")}`);
  console.log(`Terminal: ${machine.terminal.length ? machine.terminal.map((s) => `\`${s}\``).join(", ") : "none"}\n`);
  console.log("| Action | From | To | Permission | Reason | Freezes |");
  console.log("|---|---|---|---|---|---|");
  for (const t of machine.transitions) {
    console.log(
      `| \`${t.action}\` | ${t.from.map((s) => `\`${s}\``).join(", ")} | \`${t.to}\` | \`${t.permission}\` | ${t.requiresReason ? "required" : "—"} | ${t.freezes ?? "—"} |`,
    );
  }
  console.log();
}
