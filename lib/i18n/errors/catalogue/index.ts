import { compileCatalogue, type Catalogue, type CompiledCatalogue } from "@/lib/i18n/catalogue";
import { messages } from "@/lib/i18n/messages";
import { moduleMessages } from "@/lib/i18n/modules";
import { slotWords } from "@/lib/i18n/system/slots";

import { rows as client } from "./sq/client";
import { rows as engineeringDocuments } from "./sq/engineering-documents";
import { rows as financeLegal } from "./sq/finance-legal";
import { rows as organisation } from "./sq/organisation";
import { rows as people } from "./sq/people";
import { rows as projects } from "./sq/projects";
import { rows as salesSupply } from "./sq/sales-supply";
import { rows as shared } from "./sq/shared";
import { rows as site } from "./sq/site";
import { rows as zod } from "./zod";

/**
 * Every English sentence a refusal can carry, in Albanian: the eight area files, zod's own English, and
 * the sentences the interface already translates by key.
 *
 * Server only — about 240 KB of source that no page needs in its bundle (scripts/check-client-bundle.ts
 * keeps it out). The browser's own few sentences are sq/client.ts, read by lib/i18n/errors/client.ts.
 * Compiled on the first Albanian answer; an English reader never reaches it.
 */

type Branch = { [key: string]: Branch | string };

/** English → Albanian for every string both dictionaries hold at the same path under `server` (and the sign-in errors). */
function dictionaryPairs(en: unknown, sq: unknown, into: Record<string, string>): void {
  if (typeof en === "string") {
    if (typeof sq === "string" && sq.trim() && sq !== en) into[en] = sq;
    return;
  }
  if (!en || typeof en !== "object") return;
  for (const key of Object.keys(en)) dictionaryPairs((en as Branch)[key], (sq as Branch | undefined)?.[key], into);
}

/**
 * The text the modules' own client hooks already map by key (`<module>.server.*`, `auth.errors`).
 * Merged at load rather than copied, so the two cannot drift; a row of the area files wins over it.
 */
function seeds(): Catalogue {
  const pairs: Record<string, string> = {};
  for (const [namespace, dictionary] of Object.entries(moduleMessages.en)) {
    const server = (dictionary as Branch).server;
    if (server) dictionaryPairs(server, (moduleMessages.sq as unknown as Record<string, Branch>)[namespace]?.server, pairs);
  }
  const auth = (messages.en as unknown as Record<string, Branch>).auth;
  if (auth?.errors) dictionaryPairs(auth.errors, (messages.sq as unknown as Record<string, Branch>).auth?.errors, pairs);
  return pairs;
}

let compiled: CompiledCatalogue | undefined;

export function errorCatalogue(): CompiledCatalogue {
  compiled ??= compileCatalogue([seeds(), client, zod, shared, site, people, organisation, financeLegal, salesSupply, projects, engineeringDocuments] as readonly Catalogue[], { words: slotWords });
  return compiled;
}
