import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

/** Shared source walking for the authorization verifiers (PRD #47 §105, §107, §164-§166). */

export function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(full)) out.push(full.split(path.sep).join("/"));
  }
  return out.sort();
}

export function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

export function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Whether a function-like body starts with the `"use server"` directive. */
export function hasUseServerDirective(body: ts.Node | undefined): boolean {
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server");
}

export function fileHasUseServer(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server");
}

/** Every identifier called anywhere inside a node: `foo()`, `a.foo()` both yield `foo`. */
export function calledNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isIdentifier(callee)) names.add(callee.text);
      else if (ts.isPropertyAccessExpression(callee)) names.add(callee.name.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return names;
}
