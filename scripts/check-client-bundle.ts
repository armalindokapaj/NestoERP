/**
 * Client bundle boundary (AUD-12 DX-04).
 *
 * Every module a `"use client"` file reaches through its runtime imports ends up
 * in the browser bundle. None of them may import the database client, the
 * database layer, a Node built-in, or read a server secret from `process.env`.
 * Next.js would inline an unprefixed `process.env.X` as `undefined` on the
 * client, and would fail — or worse, try to polyfill — a Node built-in.
 *
 * The scan is static: it follows `import`/`export … from` and literal
 * `import()` from each client entry, skips type-only imports (erased at build),
 * and stops at a `"use server"` file, which the bundler replaces with a
 * reference to the server action rather than including it.
 *
 * `pnpm check:client-bundle` — exits non-zero and prints each violation with
 * the import chain that reaches it.
 */
import { existsSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { fileHasUseServer, parse, walk } from "./security/source";

const ROOTS = ["app", "components", "lib", "config", "types"];
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".jsx"];

/** Package specifiers a browser module must never import. */
const FORBIDDEN_PACKAGES: Array<[RegExp, string]> = [
  [/^\.prisma(\/|$)/, "the generated Prisma client"],
  [/^@\/lib\/database(\/|$)/, "the database layer"],
  [/^server-only$/, "a server-only module"],
  [/^(bcrypt|bcryptjs|argon2|nodemailer|pg)$/, "a server-side package"],
];

const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/**
 * `@prisma/client` itself is allowed: its package `browser` entry exposes only
 * the enums and `Prisma.Decimal`, which shared schemas and money helpers use.
 * What must never reach the browser is the client class.
 */
const FORBIDDEN_PRISMA_NAMES = new Set(["PrismaClient"]);

/**
 * Reviewed exceptions: `file` may make `problem` (a substring) reachable from
 * a client module, for the reason given. Each must still match something, so
 * a fixed one is removed rather than left as an open door.
 */
export const CLIENT_BUNDLE_EXCEPTIONS: Array<{ file: string; problem: string; reason: string }> = [
  {
    file: "lib/core/storage/scanner.ts",
    problem: "process.env.STORAGE_SCANNER",
    reason:
      "fileScanner() runs only in the upload pipeline on the server; the uploader reaches this file only through lib/core/storage's re-exports for UPLOAD_RETRY_LIMIT, and the name is configuration, not a secret",
  },
];

/** `process.env` names the client may read: Next inlines these at build. */
const PUBLIC_ENV = /^(NEXT_PUBLIC_\w+|NODE_ENV)$/;

export type ClientBundleViolation = { file: string; line: number; problem: string; chain: string[] };

function isClientEntry(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function resolveFile(base: string): string | null {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const extension of EXTENSIONS) if (existsSync(base + extension)) return base + extension;
  for (const extension of EXTENSIONS) if (existsSync(`${base}/index${extension}`)) return `${base}/index${extension}`;
  return null;
}

/** A repository file for a local specifier, or null for a package. */
export function resolveLocal(specifier: string, from: string): string | null {
  if (specifier.startsWith("@/")) return resolveFile(specifier.slice(2));
  if (!specifier.startsWith(".")) return null;
  const base = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    else if (part === "..") base.pop();
    else base.push(part);
  }
  return resolveFile(base.join("/"));
}

type Edge = { specifier: string; line: number; names: string[] };

/** The runtime imports of a module: type-only ones are erased and do not count. */
export function runtimeImports(source: ts.SourceFile): Edge[] {
  const edges: Edge[] = [];
  const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      const allTypes =
        clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly);
      if (allTypes) continue;
      const names = named && ts.isNamedImports(named) ? named.elements.filter((element) => !element.isTypeOnly).map((element) => (element.propertyName ?? element.name).text) : [];
      edges.push({ specifier: statement.moduleSpecifier.text, line: line(statement), names });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.isTypeOnly) continue;
      const names = statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements.map((element) => (element.propertyName ?? element.name).text) : [];
      edges.push({ specifier: statement.moduleSpecifier.text, line: line(statement), names });
    }
  }
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      edges.push({ specifier: node.arguments[0].text, line: line(node), names: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

/** Unprefixed `process.env.X` / `process.env["X"]` reads in a module. */
export function serverEnvReads(source: ts.SourceFile): Array<{ name: string; line: number }> {
  const reads: Array<{ name: string; line: number }> = [];
  const isProcessEnv = (node: ts.Node) =>
    ts.isPropertyAccessExpression(node) && node.name.text === "env" && ts.isIdentifier(node.expression) && node.expression.text === "process";
  const visit = (node: ts.Node) => {
    let name: string | null = null;
    if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) name = node.name.text;
    else if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression) && ts.isStringLiteralLike(node.argumentExpression)) {
      name = node.argumentExpression.text;
    }
    if (name && !PUBLIC_ENV.test(name)) {
      reads.push({ name, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reads;
}

function forbiddenReason(specifier: string, names: string[]): string | null {
  if (/^@prisma\/client(\/|$)/.test(specifier)) {
    const server = names.filter((name) => FORBIDDEN_PRISMA_NAMES.has(name));
    return server.length > 0 ? `the Prisma client class (${server.join(", ")})` : null;
  }
  if (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(specifier.split("/")[0])) return `the Node built-in "${specifier}"`;
  for (const [pattern, reason] of FORBIDDEN_PACKAGES) if (pattern.test(specifier)) return reason;
  return null;
}

/**
 * Walk from every client entry. `entries` defaults to every `"use client"`
 * file under the source roots; a test passes its own to plant a violation.
 */
export function clientBundleViolations(entries?: string[], exceptions = CLIENT_BUNDLE_EXCEPTIONS): ClientBundleViolation[] {
  const usedExceptions = new Set<(typeof exceptions)[number]>();
  const accept = (file: string) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".d.ts");
  const starts = entries ?? ROOTS.filter((root) => existsSync(root)).flatMap((root) => walk(root, accept)).filter((file) => isClientEntry(parse(file)));

  const violations: ClientBundleViolation[] = [];
  const reported = new Set<string>();
  const parents = new Map<string, string | null>();
  const queue: string[] = [];
  for (const start of starts) {
    if (!parents.has(start)) {
      parents.set(start, null);
      queue.push(start);
    }
  }

  const chainOf = (file: string) => {
    const chain: string[] = [];
    for (let current: string | null = file; current; current = parents.get(current) ?? null) chain.unshift(current);
    return chain;
  };
  const report = (violation: ClientBundleViolation) => {
    const exception = exceptions.find((candidate) => candidate.file === violation.file && violation.problem.includes(candidate.problem));
    if (exception) {
      usedExceptions.add(exception);
      return;
    }
    const key = `${violation.file}:${violation.line}:${violation.problem}`;
    if (reported.has(key)) return;
    reported.add(key);
    violations.push(violation);
  };

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = parse(file);
    // A server action module crosses to the client as a reference, not as code.
    if (parents.get(file) !== null && fileHasUseServer(source)) continue;

    for (const read of serverEnvReads(source)) {
      report({ file, line: read.line, problem: `reads process.env.${read.name}, which is not NEXT_PUBLIC_ and is undefined (or a leaked secret) in the browser`, chain: chainOf(file) });
    }
    for (const edge of runtimeImports(source)) {
      const reason = forbiddenReason(edge.specifier, edge.names);
      if (reason) {
        report({ file, line: edge.line, problem: `imports ${reason} ("${edge.specifier}")`, chain: chainOf(file) });
        continue;
      }
      const target = resolveLocal(edge.specifier, file);
      if (!target || parents.has(target)) continue;
      parents.set(target, file);
      queue.push(target);
    }
  }
  // Only a full scan can say an exception is stale.
  if (!entries) {
    for (const exception of exceptions) {
      if (!usedExceptions.has(exception)) {
        violations.push({ file: exception.file, line: 0, problem: `the exception for "${exception.problem}" no longer matches anything; remove it from CLIENT_BUNDLE_EXCEPTIONS`, chain: [] });
      }
    }
  }
  return violations;
}

export function formatViolation(violation: ClientBundleViolation): string {
  return `${violation.file}:${violation.line} ${violation.problem}\n      reached from ${violation.chain.join(" → ")}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = clientBundleViolations();
  if (violations.length > 0) {
    console.error(`✗ client bundle — ${violations.length} server-only import(s) reachable from a "use client" module:\n`);
    for (const violation of violations) console.error(`  ${formatViolation(violation)}`);
    console.error(`\nMove the server work behind a server action or route, or split the shared module so the client half imports nothing server-side.`);
    process.exit(1);
  }
  console.log("✓ client bundle — no server-only import reachable from a \"use client\" module");
}
