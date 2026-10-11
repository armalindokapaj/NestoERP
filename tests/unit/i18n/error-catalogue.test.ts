import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { holesOf, MACHINE_CODE, UNTRANSLATED, type CatalogueRow } from "@/lib/i18n/catalogue";
import { rows as client } from "@/lib/i18n/errors/catalogue/sq/client";
import { rows as engineeringDocuments } from "@/lib/i18n/errors/catalogue/sq/engineering-documents";
import { rows as financeLegal } from "@/lib/i18n/errors/catalogue/sq/finance-legal";
import { rows as organisation } from "@/lib/i18n/errors/catalogue/sq/organisation";
import { rows as people } from "@/lib/i18n/errors/catalogue/sq/people";
import { rows as projects } from "@/lib/i18n/errors/catalogue/sq/projects";
import { rows as salesSupply } from "@/lib/i18n/errors/catalogue/sq/sales-supply";
import { rows as shared } from "@/lib/i18n/errors/catalogue/sq/shared";
import { rows as site } from "@/lib/i18n/errors/catalogue/sq/site";
import { rows as zod } from "@/lib/i18n/errors/catalogue/zod";
import { localizeClient } from "@/lib/i18n/errors/client";
import { localizeDetails, localizeFieldErrors, localizeMessage } from "@/lib/i18n/errors";
import { API_COPY } from "@/lib/client/api-request";
import { OUTCOME_COPY } from "@/lib/unsaved/outcome";
import { z } from "zod";

/**
 * Server refusals in the reader's language (lib/i18n/errors).
 *
 * Services throw English and keep doing so; the sentence is put into Albanian only as an answer leaves
 * the server. These tests hold the catalogue well formed, hold the English answer byte for byte, walk
 * sample refusals through the two edges, and fail when a new refusal is written without a catalogue row.
 */

const locale = vi.hoisted(() => ({ value: "sq" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "nesto.locale" ? { value: locale.value } : undefined) }),
  headers: async () => new Headers(),
}));

const FILES: Record<string, Record<string, CatalogueRow>> = {
  shared,
  site,
  people,
  organisation,
  "finance-legal": financeLegal,
  "sales-supply": salesSupply,
  projects,
  "engineering-documents": engineeringDocuments,
  zod,
  client,
};

const sqOf = (row: CatalogueRow) => (typeof row === "string" ? row : row.sq);
const allRows = Object.entries(FILES).flatMap(([file, rows]) => Object.entries(rows).map(([key, row]) => ({ file, key, row })));

describe("the catalogue", () => {
  it("holds a row once across the area files", () => {
    // The client file repeats rows of shared.ts on purpose (below); everything else is one row, one place.
    const seen = new Map<string, string>();
    const twice: string[] = [];
    for (const { file, key } of allRows) {
      if (file === "client") continue;
      if (seen.has(key)) twice.push(`${key} (${seen.get(key)} and ${file})`);
      seen.set(key, file);
    }
    expect(twice).toEqual([]);
  });

  it("keeps the holes of every sentence in its Albanian, and names slots only for holes that exist", () => {
    const wrong: string[] = [];
    for (const { file, key, row } of allRows) {
      const english = holesOf(key).sort().join(",");
      const albanian = holesOf(sqOf(row)).sort().join(",");
      if (english !== albanian) wrong.push(`${file}: ${key} → ${sqOf(row)}`);
      if (typeof row !== "string") for (const slot of Object.keys(row.slots ?? {})) if (!holesOf(key).includes(slot)) wrong.push(`${file}: ${key} names slot ${slot}`);
    }
    expect(wrong).toEqual([]);
  });

  it("has no row left to translate, no empty one, and no key that is a machine code", () => {
    const wrong = allRows.filter(({ key, row }) => !sqOf(row).trim() || sqOf(row).includes(UNTRANSLATED) || MACHINE_CODE.test(key)).map(({ file, key }) => `${file}: ${key}`);
    expect(wrong).toEqual([]);
  });

  it("is the same as shared.ts where the browser repeats a row", () => {
    const drifted = Object.entries(client).filter(([key, row]) => key in shared && sqOf(shared[key as keyof typeof shared] as CatalogueRow) !== sqOf(row)).map(([key]) => key);
    expect(drifted).toEqual([]);
  });

  it("answers the browser's own sentences: the request helper's copy and the save outcome's", () => {
    const own = [
      "Check your connection and try again.",
      "This is taking longer than expected. Try again.",
      "The request was replaced by a newer one.",
      "Too many requests. Try again in a moment.",
      "Something went wrong.",
      "Changes weren't saved. Your entries are still here.",
      "We couldn't confirm whether this saved. Check the record before trying again.",
      "Your workspace changed in another tab, so nothing was saved. Your entries are still here.",
    ];
    expect(own.filter((text) => !(text in client))).toEqual([]);
    expect("Too many requests. Try again in {0} seconds." in client).toBe(true);
  });
});

describe("the English answer", () => {
  it("is the very text that was passed in", () => {
    const sentence = "You do not have permission to perform this action.";
    expect(localizeMessage(sentence, "en")).toBe(sentence);
    const fields = { title: ["Enter a title."] };
    expect(localizeFieldErrors(fields, "en")).toBe(fields);
    const details = { title: ["Enter a title.", "Use a longer one."], code: "X_Y" };
    expect(localizeDetails(details, "en")).toBe(details);
  });

  it("is what the browser's copy says without a document, and with an English one", () => {
    expect(API_COPY.generic).toBe("Something went wrong.");
    expect(API_COPY.rateLimited(5)).toBe("Too many requests. Try again in 5 seconds.");
    expect(OUTCOME_COPY.notSaved).toBe("Changes weren't saved. Your entries are still here.");
    expect(localizeClient("Enter a unit price.")).toBe("Enter a unit price.");
  });
});

describe("the Albanian answer", () => {
  it("finds a sentence, a sentence with values in it, and a refusal of several sentences", () => {
    expect(localizeMessage("You are not signed in.", "sq")).toBe("Nuk keni hyrë në llogari.");
    expect(localizeMessage("Too many requests. Try again in 7 seconds.", "sq")).toBe("Shumë kërkesa. Provoni përsëri pas 7 sekondash.");
    expect(localizeMessage("Invalid request. You are not signed in.", "sq")).toBe("Kërkesë e pavlefshme. Nuk keni hyrë në llogari.");
  });

  it("never half translates: one sentence nobody wrote leaves the whole refusal in English", () => {
    const mixed = "Invalid request. A sentence no catalogue holds.";
    expect(localizeMessage(mixed, "sq")).toBe(mixed);
  });

  it("leaves a machine code alone", () => {
    for (const code of ["RATE_LIMITED", "COMMENT_TOO_LONG", "SELF_REVIEW_NOT_ALLOWED"]) expect(localizeMessage(code, "sq")).toBe(code);
  });

  it("translates the words a status or a label carries into a sentence", () => {
    expect(localizeMessage("A budget cannot move from Draft to Closed.", "sq")).toContain("Një buxhet nuk mund të kalojë nga");
    expect(localizeMessage("Enter a title.", "sq")).not.toBe("Enter a title.");
  });

  it("translates every default sentence zod writes for a schema that gave none", () => {
    const schema = z.object({
      text: z.string().min(3).max(5),
      count: z.number().int().min(1).max(9),
      list: z.array(z.string()).min(1),
      mail: z.email(),
      choice: z.enum(["a", "b"]),
      flag: z.boolean(),
    });
    const bad = schema.safeParse({ text: "", count: 0.5, list: [], mail: "x", choice: "z", flag: "yes" });
    expect(bad.success).toBe(false);
    const issues = bad.success ? [] : bad.error.issues.map((issue) => issue.message);
    expect(issues.length).toBeGreaterThanOrEqual(6);
    for (const message of [...issues, ...(schema.safeParse({}).error?.issues.map((issue) => issue.message) ?? [])]) {
      expect(localizeMessage(message, "sq"), message).not.toBe(message);
    }
  });

  it("puts a details list of sentences into Albanian and leaves codes, field names and other data", () => {
    const details = { title: ["Invalid request.", "You are not signed in."], code: "SOME_CODE", field: "title", fields: ["submittalType"], count: 3 };
    expect(localizeDetails(details, "sq")).toEqual({ ...details, title: ["Kërkesë e pavlefshme.", "Nuk keni hyrë në llogari."] });
  });
});

describe("the two edges", () => {
  beforeEach(() => {
    locale.value = "sq";
  });

  async function inContext<T>(value: string, run: () => T | Promise<T>): Promise<T> {
    locale.value = value;
    const { requestLocale } = await import("@/lib/i18n/errors/server");
    const { runWithRequestContext } = await import("@/lib/core/observability/request-context");
    const read = await requestLocale();
    return runWithRequestContext({ requestId: "req_test", correlationId: "corr_test", startedAt: Date.now(), locale: read }, run);
  }

  it("words a route's refusal in the reader's language and keeps its machine codes", async () => {
    const { apiError } = await import("@/lib/api/respond");
    const body = await inContext("sq", () => apiError("CONFLICT", "Invalid request.", { code: "RATE_LIMITED", title: ["Invalid request.", "You are not signed in."] }).json());
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toBe("Kërkesë e pavlefshme.");
    expect(body.error.details.code).toBe("RATE_LIMITED");
    expect(body.error.details.title).toEqual(["Kërkesë e pavlefshme.", "Nuk keni hyrë në llogari."]);
    expect(body.error.fieldErrors.title).toEqual(["Kërkesë e pavlefshme.", "Nuk keni hyrë në llogari."]);
  });

  it("derives the field errors from the English: a one-word Albanian sentence does not drop its field", async () => {
    const { apiError } = await import("@/lib/api/respond");
    const body = await inContext("sq", () => apiError("VALIDATION_ERROR", "Invalid request.", { field: "title" }).json());
    expect(body.error.fieldErrors).toEqual({ title: ["Kërkesë e pavlefshme."] });
  });

  it("answers the default sentence of a code in Albanian", async () => {
    const { apiError } = await import("@/lib/api/respond");
    const body = await inContext("sq", () => apiError("UNAUTHENTICATED").json());
    expect(body.error.message).toBe("Nuk keni hyrë në llogari.");
  });

  it("answers an English reader, and a request with no language at all, exactly as before", async () => {
    const { apiError } = await import("@/lib/api/respond");
    const english = await inContext("en", () => apiError("CONFLICT", "Invalid request.", { title: ["Invalid request.", "You are not signed in."] }).json());
    expect(english.error.message).toBe("Invalid request.");
    expect(english.error.details.title).toEqual(["Invalid request.", "You are not signed in."]);
    const bare = await apiError("UNAUTHENTICATED").json();
    expect(bare.error.message).toBe("You are not signed in.");
  });

  it("words a server action's failure, and keeps its code, category and reference", async () => {
    const { AccessError } = await import("@/lib/access/guards");
    const { actionFailure, readActionFailure, validationFailure } = await import("@/lib/actions/result");
    locale.value = "sq";
    const failure = await actionFailure(new AccessError("UNAUTHENTICATED"));
    const english = readActionFailure(new AccessError("UNAUTHENTICATED"));
    expect(failure.error).toBe("Nuk keni hyrë në llogari.");
    expect({ ...failure, error: english.error }).toEqual(english);
    const invalid = await validationFailure(z.object({ name: z.string() }).safeParse({}).error!, "Invalid request.");
    expect(invalid.code).toBe("VALIDATION_ERROR");
    expect(Object.values(invalid.fieldErrors ?? {}).flat().every((text) => text !== "Invalid input: expected string, received undefined")).toBe(true);
    locale.value = "en";
    expect((await actionFailure(new AccessError("UNAUTHENTICATED"))).error).toBe("You are not signed in.");
  });
});

/* -------------------------------------------------------------------------- */
/* The guard: a refusal written without a catalogue row                        */
/* -------------------------------------------------------------------------- */

const ROOT = process.cwd();

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === "errors" && dir.endsWith(path.join("lib", "i18n"))) continue;
      sourceFiles(full, found);
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

/** `cond ? "one" : "other"`, the plural a sentence picks inside a substitution: the catalogue holds a row for each. */
function literalChoice(node: ts.Expression): [string, string] | null {
  const expression = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (!ts.isConditionalExpression(expression)) return null;
  const { whenTrue, whenFalse } = expression;
  const isText = (value: ts.Expression): value is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral => ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value);
  return isText(whenTrue) && isText(whenFalse) ? [whenTrue.text, whenFalse.text] : null;
}

/**
 * The catalogue keys a message can be: its text, each distinct substitution a numbered hole by first
 * appearance, and a substitution that is a choice between two words written out in each of its forms.
 */
function keysOf(node: ts.Expression, source: ts.SourceFile): string[] | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (!ts.isTemplateExpression(node)) return null;
  const numbers: string[] = [];
  let keys = [node.head.text];
  for (const span of node.templateSpans) {
    const text = span.expression.getText(source);
    if (!numbers.includes(text)) numbers.push(text);
    const choice = literalChoice(span.expression);
    const pieces = choice ?? [`{${numbers.indexOf(text)}}`];
    keys = keys.flatMap((key) => pieces.map((piece) => key + piece + span.literal.text));
  }
  return keys;
}

type Written = { keys: string[]; where: string; template: boolean };

function writtenMessages(): { literals: Written[]; dynamic: string[] } {
  const literals: Written[] = [];
  const dynamic: string[] = [];
  for (const file of [...sourceFiles(path.join(ROOT, "lib")), ...sourceFiles(path.join(ROOT, "app"))]) {
    const text = readFileSync(file, "utf8");
    if (!/new AccessError\(|apiError\(/.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      const thrown = ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "AccessError";
      const answered = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "apiError";
      if ((thrown || answered) && node.arguments && node.arguments.length >= 2) {
        const where = `${path.relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
        const keys = keysOf(node.arguments[1], source);
        if (keys === null) dynamic.push(`${where}  ${node.arguments[1].getText(source).slice(0, 80)}`);
        else if (keys[0] && !MACHINE_CODE.test(keys[0])) literals.push({ keys, where, template: ts.isTemplateExpression(node.arguments[1]) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { literals, dynamic };
}

/**
 * Sentences that stay as they are, each with the reason. A refusal may also be answered by a row of the
 * catalogue under its own text, so this is for the few that are not sentences of the product's own.
 */
const UNCHANGED: Record<string, string> = {};

describe("the guard", () => {
  const { literals } = writtenMessages();
  const keys = new Set(allRows.map(({ key }) => key));
  const filled = (key: string) => key.replace(/\{\d+\}/g, "Alpha");

  /** A sentence is covered by its own row, or, for a template, by a pattern its sentence fits (a repeated value may be one hole there). */
  const covered = (key: string, template: boolean) => (template ? keys.has(key) || localizeMessage(filled(key), "sq") !== filled(key) : localizeMessage(key, "sq") !== key);

  it("finds the refusals the services write", () => {
    expect(literals.length).toBeGreaterThan(1000);
  });

  it("holds a catalogue row for every AccessError or apiError message written as a literal or a template", () => {
    const missing = literals
      .flatMap(({ keys: variants, where, template }) => variants.map((key) => ({ key, where, template })))
      .filter(({ key, template }) => UNCHANGED[key] === undefined && !covered(key, template))
      .map(({ key, where }) => `${where}  ${key}`);
    expect(missing).toEqual([]);
  });

  it("allows nothing it does not need", () => {
    const written = new Set(literals.flatMap(({ keys: variants }) => variants));
    expect(Object.keys(UNCHANGED).filter((key) => !written.has(key))).toEqual([]);
  });
});
