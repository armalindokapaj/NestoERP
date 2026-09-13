/**
 * Company bootstrap (PRD #38 §19).
 *
 * Provisions a real company without the demo seed: the company, its settings,
 * module switches, numbering, integration settings and storage quota, plus an
 * invitation for its first Owner. The Owner chooses their own password from
 * the emailed link — nobody running this command ever handles one.
 *
 * Idempotent by slug: rerunning fills in anything missing and changes nothing
 * that exists.
 *
 *   tsx scripts/company-bootstrap.ts \
 *     --name="Acme Construction" --slug=acme --owner-email=owner@acme.example \
 *     [--legal-name="Acme Construction Sh.p.k."] [--country=Albania] \
 *     [--timezone=Europe/Tirane] [--locale=sq-AL] [--currency=EUR] \
 *     [--disable=hse,qaqc]
 *
 * Run `pnpm access:sync` first on a fresh database.
 */
import { appEnvironment } from "../lib/config/env";
import { bootstrapCompany } from "../lib/modules/company/company-bootstrap.service";
import type { ModuleKey } from "../config/modules";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const name = arg("name");
  const slug = arg("slug");
  const ownerEmail = arg("owner-email");
  if (!name || !slug || !ownerEmail) {
    console.error("Usage: tsx scripts/company-bootstrap.ts --name=... --slug=... --owner-email=...");
    process.exit(2);
  }

  console.log(`Company bootstrap — environment=${appEnvironment()}\n`);

  const result = await bootstrapCompany({
    name,
    slug,
    ownerEmail,
    legalName: arg("legal-name"),
    country: arg("country"),
    timezone: arg("timezone"),
    locale: arg("locale"),
    baseCurrency: arg("currency"),
    disabledModules: (arg("disable") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean) as ModuleKey[],
  });

  console.log(`  company   ${result.slug} (${result.companyId}) — ${result.companyCreated ? "created" : "already existed"}`);
  console.log(`  modules   ${result.modulesEnabled.length} enabled${result.modulesDisabled.length ? `, disabled: ${result.modulesDisabled.join(", ")}` : ""}`);
  switch (result.owner.state) {
    case "ALREADY_ACTIVE":
      console.log("  owner     already an active Owner — nothing sent");
      break;
    case "INVITATION_PENDING":
      console.log(`  owner     an invitation is already pending (${result.owner.inviteId}) — resend it from Team if it was lost`);
      break;
    case "INVITED":
      console.log(`  owner     invited (${result.owner.inviteId}), email ${result.owner.delivery}`);
      if (result.owner.inviteUrl) console.log(`            link: ${result.owner.inviteUrl}`);
      if (result.owner.delivery !== "SENT") process.exitCode = 3;
      break;
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error("Company bootstrap failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .then(() => process.exit(process.exitCode ?? 0));
