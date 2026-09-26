/**
 * Runs a destructive database command only against a disposable local
 * database, after confirmation (AUD-12 §5).
 *
 *   pnpm db:reset:demo     reset   prisma migrate reset --force (drop, migrate, seed)
 *   pnpm db:migrate        migrate prisma migrate dev (may offer a reset on drift)
 *   pnpm db:push           push    prisma db push
 *
 * Before the command starts:
 * - the environment must not say production or staging;
 * - `DIRECT_URL` and `DATABASE_URL` (Prisma migrates through one and seeds
 *   through the other) must name one database, on this machine, listed in
 *   `NESTO_DISPOSABLE_DATABASES`;
 * - a person at a terminal types the database's name to confirm. Without a
 *   terminal, only CI may go on, with `CI=true` and
 *   `NESTO_CONFIRM_DESTRUCTIVE=<database>` naming the same database.
 *
 * A refusal says why, names the database and host, and never prints a URL.
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

import { checkDestructiveTarget, parseTarget } from "../../lib/core/database/target";

const COMMANDS: Record<string, { args: string[]; describe: string }> = {
  reset: { args: ["prisma", "migrate", "reset", "--force"], describe: "drop every table, re-apply every migration and re-seed" },
  migrate: { args: ["prisma", "migrate", "dev"], describe: "create and apply a migration (Prisma may offer to reset on drift)" },
  push: { args: ["prisma", "db", "push"], describe: "push the schema without a migration" },
};

function refuse(name: string, reason: string): never {
  console.error(`db:${name} refused: ${reason}`);
  process.exit(1);
}

async function main() {
  const [name, ...extra] = process.argv.slice(2);
  const command = name ? COMMANDS[name] : undefined;
  if (!name || !command) refuse(name ?? "?", `unknown command. Use one of: ${Object.keys(COMMANDS).join(", ")}.`);

  // Prisma migrates through DIRECT_URL and seeds through DATABASE_URL: both
  // must be disposable, and they must be the same database.
  const urls = [process.env.DIRECT_URL, process.env.DATABASE_URL].filter((url): url is string => Boolean(url));
  if (urls.length === 0) refuse(name, "neither DIRECT_URL nor DATABASE_URL is set.");
  const targets = urls.map((url) => {
    try {
      return parseTarget(url);
    } catch (error) {
      refuse(name, (error as Error).message);
    }
  });
  for (const candidate of targets) {
    const verdict = checkDestructiveTarget(candidate, process.env);
    if (!verdict.ok) refuse(name, verdict.reason);
  }
  const target = targets[0]!;
  if (targets.some((candidate) => candidate.key !== target.key)) {
    refuse(name, "DIRECT_URL and DATABASE_URL name different databases; set them to the one disposable database.");
  }

  if (process.stdin.isTTY) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt.question(`This will ${command.describe} in ${target.label}.\nType the database name to continue: `);
    prompt.close();
    if (answer.trim() !== target.database) refuse(name, "the name typed did not match; nothing was changed.");
  } else if (process.env.CI !== "true" || process.env.NESTO_CONFIRM_DESTRUCTIVE !== target.database) {
    refuse(
      name,
      `no terminal to confirm at. A CI job on an isolated database may set CI=true and NESTO_CONFIRM_DESTRUCTIVE="${target.database}".`,
    );
  }

  const result = spawnSync("npx", [...command.args, ...extra], { stdio: "inherit", env: process.env });
  process.exit(result.status ?? 1);
}

void main();
