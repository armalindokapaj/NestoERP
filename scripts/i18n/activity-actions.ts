import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

import { rows as commercial } from "../../lib/i18n/system/sq/activity-commercial";
import { rows as coordination } from "../../lib/i18n/system/sq/activity-coordination";
import { rows as peopleStructure } from "../../lib/i18n/system/sq/activity-people-structure";
import { rows as site } from "../../lib/i18n/system/sq/activity-site";
import { lineOf, parse, walk } from "../security/source";

/**
 * Which activity sentences each action code writes.
 *
 * An activity line is stored as an action code and an English phrase
 * (lib/modules/shared/activity.ts). The phrase is put into the reader's
 * language by finding it in a catalogue (lib/i18n/system), and several modules
 * write phrases that look alike — "archived {name}" is a document here and a
 * unit there — so the catalogue is asked only about the phrases the row's own
 * action code can have written. This reads that from the source: every place a
 * code and a phrase are written together, and the catalogue key each phrase
 * answers to.
 *
 *   npx tsx scripts/i18n/activity-actions.ts          # what it found, and what has no row
 *   npx tsx scripts/i18n/activity-actions.ts --write  # regenerate lib/i18n/system/activity-actions.ts
 *
 * tests/unit/i18n/system-text.test.ts holds the committed file equal to what
 * the source says, and fails for a phrase with no catalogue row and for a
 * place this could not read.
 */

export const ACTION_INDEX_FILE = join(process.cwd(), "lib", "i18n", "system", "activity-actions.ts");

/** Every activity row, whichever catalogue file holds it. */
export const ACTIVITY_ROWS: Readonly<Record<string, unknown>> = { ...site, ...coordination, ...commercial, ...peopleStructure };

export type ActivitySite = {
  file: string;
  line: number;
  /** Exact codes, or a prefix ending in `*` where the code is built from a variable (`HR_CANDIDATE_${to}`). */
  actions: string[];
  /** The phrases as the source writes them, `{holes}` named as the catalogue names them. */
  phrases: string[];
};

/** A place a code and a phrase are written together that the scan could not turn into phrases. */
export type UnreadSite = { file: string; line: number; action: string; phrase: string };

/* -------------------------------------------------------------------------- */
/* Reading a phrase                                                            */
/* -------------------------------------------------------------------------- */

const HOLE = "\u0000";

type Piece = { text: string; sources: string[] };

const isText = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
const flat = (source: ts.SourceFile, node: ts.Node) => node.getText(source).replace(/\s+/g, " ");
const letters = (text: string) => text.replace(/\{\w+\}/g, "").replace(/[^\p{L}]/gu, "").length;

/** Text, or a choice whose every branch is text: `status === "EXPIRED" ? "expired" : "expires"`. */
function isWords(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isWords(node.expression);
  if (ts.isConditionalExpression(node)) return isWords(node.whenTrue) && isWords(node.whenFalse);
  return isText(node) || ts.isTemplateExpression(node);
}

/** An expression as the sentences it can be: a ternary gives one per branch, anything that is not text is a hole. */
function expand(node: ts.Expression | ts.ConciseBody | undefined, source: ts.SourceFile, depth = 0): Piece[] {
  if (!node || depth > 6) return [{ text: HOLE, sources: ["?"] }];
  if (ts.isParenthesizedExpression(node)) return expand(node.expression, source, depth + 1);
  if (isText(node)) return [{ text: node.text, sources: [] }];
  if (ts.isConditionalExpression(node)) return [...expand(node.whenTrue, source, depth + 1), ...expand(node.whenFalse, source, depth + 1)];
  if (ts.isArrowFunction(node)) return expand(node.body, source, depth + 1);
  if (ts.isTemplateExpression(node)) {
    let sentences: Piece[] = [{ text: node.head.text, sources: [] }];
    for (const span of node.templateSpans) {
      const inner = span.expression;
      // A choice between pieces of text is words, not data: "cancelled approved leave, returning …" / "cancelled a leave request".
      const pieces = isWords(inner) && ts.isConditionalExpression(inner) ? expand(inner, source, depth + 1) : [{ text: HOLE, sources: [flat(source, inner)] }];
      sentences = sentences.flatMap((sentence) => pieces.map((piece) => ({ text: sentence.text + piece.text + span.literal.text, sources: [...sentence.sources, ...piece.sources] })));
    }
    return sentences;
  }
  return [{ text: HOLE, sources: [flat(source, node)] }];
}

/**
 * A hole's name, from the expression that fills it. The catalogue keys were
 * written by this rule, so it is not to be improved: a different name is a
 * different key.
 */
function holeName(expression: string, used: Set<string>): string {
  const base =
    expression
      .replace(/\?\?.*$/, "")
      .replace(/\.toLowerCase\(\).*$/, "")
      .replace(/\.toFixed\(\d\)$/, "")
      .replace(/\(.*$/, "")
      .trim()
      .split(".")
      .pop()!
      .replace(/[^A-Za-z0-9]/g, "") || "value";
  let name = base;
  for (let next = 2; used.has(name); next += 1) name = `${base}${next}`;
  used.add(name);
  return name;
}

function named(piece: Piece): string {
  const used = new Set<string>();
  let at = 0;
  return piece.text.replace(new RegExp(HOLE, "g"), () => `{${holeName(piece.sources[at++], used)}}`);
}

/** The sentences an expression can be, each with its `{holes}`: what the attention conditions are read with as well. */
export function phrasesOf(node: ts.Expression, source: ts.SourceFile): string[] {
  return expand(node, source).map(named);
}

/* -------------------------------------------------------------------------- */
/* Reading a code                                                              */
/* -------------------------------------------------------------------------- */

const CODE = /^[A-Z][A-Z0-9_]{3,}$/;

/** The codes an action expression can be; a template with a fixed head is that prefix. */
function actionsOf(node: ts.Expression): string[] | null {
  if (ts.isParenthesizedExpression(node)) return actionsOf(node.expression);
  if (isText(node)) return CODE.test(node.text) ? [node.text] : null;
  if (ts.isConditionalExpression(node)) {
    const branches = [actionsOf(node.whenTrue), actionsOf(node.whenFalse)];
    return branches[0] && branches[1] ? [...new Set([...branches[0], ...branches[1]])] : null;
  }
  if (ts.isTemplateExpression(node) && /^[A-Z][A-Z0-9_]{3,}_$/.test(node.head.text)) return [`${node.head.text}*`];
  return null;
}

/** What a name was declared as, looking outwards from `from`: `const action = created ? "X_CREATED" : "X_UPDATED"`. */
function declaredAs(name: string, from: ts.Node): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return declaration.initializer;
      }
    }
  }
  return undefined;
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function enclosingFunction(node: ts.Node): { name: string; parameters: string[] } | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (!ts.isFunctionDeclaration(at) && !ts.isFunctionExpression(at) && !ts.isArrowFunction(at) && !ts.isMethodDeclaration(at)) continue;
    const owner = at as FunctionLike;
    const name = owner.name && ts.isIdentifier(owner.name) ? owner.name.text : ts.isVariableDeclaration(owner.parent) && ts.isIdentifier(owner.parent.name) ? owner.parent.name.text : null;
    // A callback inside the function that takes the code and the phrase (`units.map(…)`, a transaction) is not that function.
    if (!name) continue;
    return { name, parameters: owner.parameters.map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : "")) };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Sentences put together from a table                                         */
/* -------------------------------------------------------------------------- */

/**
 * The few sentences no scan reads off the source, because they are finished at
 * run time: a table of verbs with a `%s` in it, a table entry with a name put
 * after it. Each entry names the expression that writes the phrase (so a
 * change to that code drops the entry and shows the gap) and says how to read
 * the sentences: every text of a table declared in that file, or a list.
 */
type Composed = {
  file: string;
  /** The phrase expression, as written. */
  written: string;
  /** A table in that file: `property` when its entries are objects, else its own texts. */
  table?: { name: string; property?: string };
  /** One table text → the catalogue phrase. */
  phrase?: (text: string) => string;
  /** Sentences beside the table's, or the whole list where there is no table. */
  also?: string[];
  /** The codes, where the place itself takes them from a variable. */
  actions?: string[];
};

const COMPOSED: Composed[] = [
  {
    file: "lib/modules/sales/units/unit-sales.service.ts",
    written: 'verbs[input.action].replace("%s", unit.unitCode)',
    table: { name: "verbs" },
    phrase: (text) => text.replace("%s", "{unitCode}"),
  },
  {
    file: "lib/modules/contracts/units/sale-contract.ts",
    written: '() => verb.replace("%n", contract.contractNumber)',
    table: { name: "VERBS" },
    phrase: (text) => text.replace("%n", "{contractNumber}"),
    // What a move with no verb of its own falls back to.
    also: ["moved sale contract {contractNumber} to {status}"],
  },
  {
    file: "lib/modules/organization/provisioning/provisioning.service.ts",
    written: "`${step.message} ${personName}`",
    table: { name: "MOVES", property: "message" },
    phrase: (text) => `${text} {personName}`,
  },
  {
    // Blocking a task adds why to the table's own phrase.
    file: "lib/modules/tasks/task.mutation.ts",
    written: 'command.kind === "block" ? `${message}: ${command.reason.slice(0, 200)}` : message',
    also: ["marked the task blocked: {reason}"],
    actions: ["TASK_BLOCKED"],
  },
];

/** The texts of a table declared in a file: `const VERBS = { approve: "approved sale contract %n", … }`. */
function tableTexts(source: ts.SourceFile, table: NonNullable<Composed["table"]>): string[] {
  const texts: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === table.name && node.initializer) {
      let value: ts.Expression = node.initializer;
      while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression;
      if (ts.isObjectLiteralExpression(value)) {
        for (const entry of value.properties) {
          if (!ts.isPropertyAssignment(entry)) continue;
          const held = table.property && ts.isObjectLiteralExpression(entry.initializer) ? entry.initializer.properties.find((inner) => ts.isPropertyAssignment(inner) && inner.name.getText(source) === table.property) : entry;
          if (held && ts.isPropertyAssignment(held) && isText(held.initializer)) texts.push(held.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return texts;
}

/* -------------------------------------------------------------------------- */
/* The scan                                                                    */
/* -------------------------------------------------------------------------- */

const SOURCE_ROOTS = ["lib", "app"];

export type ActivityScan = { sites: ActivitySite[]; unread: UnreadSite[] };

/** Every place the application writes an action code and a phrase together. */
export function scanActivity(root = process.cwd()): ActivityScan {
  const sites: ActivitySite[] = [];
  const unread: UnreadSite[] = [];
  /** Functions that are handed the code and the phrase as arguments; their callers are read instead. */
  const helpers: { name: string; action: number; phrase: number }[] = [];
  /** Places whose code is `spec.action` and whose phrase starts from `spec.verb`: the verbs are tables in the same file. */
  const verbed: { file: string; line: number; phrases: string[] }[] = [];
  const verbs = new Map<string, Set<string>>();

  const files = SOURCE_ROOTS.flatMap((directory) => walk(join(root, directory), (file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts")));
  const texts = new Map<string, string>();
  const sources = new Map<string, ts.SourceFile>();
  for (const file of files) {
    const relative = file.slice(root.length + 1);
    if (relative.startsWith("lib/i18n/")) continue;
    const text = readFileSync(file, "utf8");
    texts.set(relative, text);
    if (text.includes("action") && (text.includes("message") || text.includes("verb"))) sources.set(relative, parse(file));
  }

  /** One place, once its code and its phrase expression are known. */
  const read = (file: string, source: ts.SourceFile, at: ts.Node, actionNode: ts.Expression, phraseNode: ts.Expression | ts.ConciseBody, field: "message" | "verb") => {
    const line = lineOf(source, at);
    const written = flat(source, phraseNode);
    const composed = COMPOSED.find((entry) => entry.file === file && entry.written === written);
    const actions = composed?.actions ?? actionsOf(actionNode as ts.Expression);
    if (composed) {
      const texts = composed.table ? tableTexts(source, composed.table).map((text) => (composed.phrase ? composed.phrase(text) : text)) : [];
      if (actions && texts.length + (composed.also?.length ?? 0) > 0) sites.push({ file, line, actions, phrases: [...texts, ...(composed.also ?? [])] });
      else unread.push({ file, line, action: flat(source, actionNode), phrase: written });
      return;
    }
    const pieces = expand(phraseNode, source);
    const phrases = pieces.map(named);
    if (phrases.every((phrase) => letters(phrase) === 0)) {
      unread.push({ file, line, action: flat(source, actionNode), phrase: written });
      return;
    }
    // A verb chosen a line above ("approved" / "returned" / "rejected") is part of the sentence it starts: its words are phrases of the same place.
    for (const piece of pieces) {
      for (const hole of piece.sources) {
        if (!/^\w+$/.test(hole)) continue;
        const choice = declaredAs(hole, at);
        const words = choice && ts.isConditionalExpression(choice) ? expand(choice, source) : [];
        if (words.length && words.every((word) => word.sources.length === 0)) phrases.push(...words.map((word) => word.text));
      }
    }
    if (actions) {
      sites.push({ file, line, actions, phrases });
      if (field === "verb") for (const action of actions) verbs.set(file, (verbs.get(file) ?? new Set()).add(action));
    } else if (pieces.some((piece) => piece.sources.some((hole) => /\.verb$/.test(hole)))) {
      verbed.push({ file, line, phrases });
    } else {
      unread.push({ file, line, action: flat(source, actionNode), phrase: written });
    }
  };

  for (const [file, source] of sources) {
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const property = (name: string) => node.properties.find((entry) => (ts.isPropertyAssignment(entry) || ts.isShorthandPropertyAssignment(entry)) && entry.name.getText(source) === name) as ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined;
        const action = property("action");
        const phrase = property("message") ?? property("verb");
        if (action && phrase) {
          const actionWritten = ts.isPropertyAssignment(action) ? action.initializer : action.name;
          const phraseWritten = ts.isPropertyAssignment(phrase) ? phrase.initializer : phrase.name;
          const actionNode = ts.isIdentifier(actionWritten) ? (declaredAs(actionWritten.text, node) ?? actionWritten) : actionWritten;
          const phraseNode = ts.isIdentifier(phraseWritten) ? (declaredAs(phraseWritten.text, node) ?? phraseWritten) : phraseWritten;
          const owner = enclosingFunction(node);
          const parameter = (written: ts.Expression) => {
            const name = ts.isIdentifier(written) ? written.text : ts.isCallExpression(written) && ts.isIdentifier(written.expression) ? written.expression.text : null;
            return name && owner ? owner.parameters.indexOf(name) : -1;
          };
          // What a row or an argument already holds is handed on, not written here: `action: row.action, message: row.message`.
          const handedOn = (written: ts.Expression): string | null => {
            if (ts.isBinaryExpression(written) && written.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return handedOn(written.left);
            const head = ts.isCallExpression(written) ? written.expression : written;
            return ts.isPropertyAccessExpression(head) ? flat(source, head.expression) : null;
          };
          if (actionWritten.kind === ts.SyntaxKind.TrueKeyword) {
            // A query's select, not a sentence.
          } else if (isText(actionNode) && !CODE.test(actionNode.text)) {
            // An object whose `action` is some other kind of word ("submit", "approve") is not an activity line.
          } else if (owner && parameter(actionWritten) >= 0 && parameter(phraseWritten) >= 0) {
            helpers.push({ name: owner.name, action: parameter(actionWritten), phrase: parameter(phraseWritten) });
          } else if (handedOn(actionWritten) !== null && handedOn(actionWritten) === handedOn(phraseWritten) && !(ts.isPropertyAccessExpression(phraseWritten) && phraseWritten.name.text === "verb")) {
            // Read where the object it comes from is written.
          } else {
            read(file, source, node, actionNode, phraseNode, phrase.name.getText(source) === "verb" ? "verb" : "message");
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // The callers of a helper: `unitActivity(tx, context, contract, "PAYMENT_VOIDED", `voided a payment on contract ${…}`)`.
  for (const [file, text] of texts) {
    if (!helpers.some((helper) => text.includes(`${helper.name}(`))) continue;
    const source = sources.get(file) ?? parse(join(root, file));
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        for (const helper of helpers) {
          if (node.expression.text !== helper.name) continue;
          const action = node.arguments[helper.action];
          const phrase = node.arguments[helper.phrase];
          if (action && phrase && actionsOf(action)) read(file, source, node, action, phrase, "message");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  for (const place of verbed) {
    const actions = [...(verbs.get(place.file) ?? [])];
    if (actions.length) sites.push({ file: place.file, line: place.line, actions, phrases: place.phrases });
    else unread.push({ file: place.file, line: place.line, action: "spec.action", phrase: place.phrases.join(" | ") });
  }

  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { sites, unread };
}

/* -------------------------------------------------------------------------- */
/* The index                                                                   */
/* -------------------------------------------------------------------------- */

export type ActionIndex = {
  /** Action code (or prefix ending in `*`) → the catalogue keys it can have written. */
  keys: Record<string, string[]>;
  /** Phrases the source writes that no catalogue row answers to. */
  missing: { phrase: string; file: string; line: number; actions: string[] }[];
};

export function buildActionIndex(scan: ActivityScan = scanActivity(), rows: Readonly<Record<string, unknown>> = ACTIVITY_ROWS): ActionIndex {
  const keys: Record<string, Set<string>> = {};
  const missing: ActionIndex["missing"] = [];
  for (const place of scan.sites) {
    for (const phrase of place.phrases) {
      // A row is found by its exact key, holes and all: "archived {name}" and "archived {unitCode}" are different sentences in Albanian.
      if (!(phrase in rows)) {
        missing.push({ phrase, file: place.file, line: place.line, actions: place.actions });
        continue;
      }
      for (const action of place.actions) (keys[action] ??= new Set()).add(phrase);
    }
  }
  return { keys: Object.fromEntries(Object.keys(keys).sort().map((action) => [action, [...keys[action]].sort()])), missing };
}

export function renderActionIndex(index: ActionIndex): string {
  const lines = [
    "/**",
    " * Action code → the English activity phrases that code can have written, as catalogue keys.",
    " *",
    " * Generated from the source by scripts/i18n/activity-actions.ts — do not edit by hand:",
    " *",
    " *   npx tsx scripts/i18n/activity-actions.ts --write",
    " *",
    " * A code ending in `*` is a prefix: the code is built from a variable where it is written",
    " * (`HR_CANDIDATE_${to}`). tests/unit/i18n/system-text.test.ts fails when this file and the source disagree.",
    " */",
    "export const ACTIVITY_ACTION_KEYS: Readonly<Record<string, readonly string[]>> = {",
    ...Object.entries(index.keys).map(([action, keys]) => `  ${/^\w+$/.test(action) ? action : JSON.stringify(action)}: [${keys.map((key) => JSON.stringify(key)).join(", ")}],`),
    "};",
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("activity-actions.ts")) {
  const scan = scanActivity();
  const index = buildActionIndex(scan);
  const indexed = new Set(Object.values(index.keys).flat());
  const orphans = Object.keys(ACTIVITY_ROWS).filter((key) => !indexed.has(key));
  for (const gap of index.missing) console.log(`no row     ${gap.file}:${gap.line}  ${gap.actions.join(", ")}  ${gap.phrase}`);
  for (const place of scan.unread) console.log(`unread     ${place.file}:${place.line}  ${place.action}  ${place.phrase}`);
  for (const key of orphans) console.log(`unwritten  ${key}`);
  console.log(`${scan.sites.length} places, ${Object.keys(index.keys).length} action codes, ${indexed.size} of ${Object.keys(ACTIVITY_ROWS).length} rows; ${index.missing.length} phrases with no row, ${scan.unread.length} places unread, ${orphans.length} rows nothing writes`);
  if (process.argv.includes("--write")) {
    writeFileSync(ACTION_INDEX_FILE, renderActionIndex(index));
    console.log(`wrote ${ACTION_INDEX_FILE}`);
  }
}
