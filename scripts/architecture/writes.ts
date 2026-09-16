import ts from "typescript";

import { lineOf, parse, walk } from "../security/source";

/**
 * Every Prisma mutation site in the runtime source (PRD #48 §251, §258).
 *
 * The scan is syntactic on purpose: `<client>.<model>.<op>(…)` is how every
 * write in this repository is spelled, whether the client is the singleton,
 * a transaction client threaded through a service, or a parameter named `db`.
 * A type-aware pass would resolve aliases we do not have, and would still miss
 * nothing this one catches.
 */

const MUTATIONS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);

/** Identifiers that hold a Prisma client or transaction client somewhere in the tree. */
const CLIENTS = new Set(["prisma", "tx", "client", "db", "database"]);

export type WriteSite = {
  file: string;
  line: number;
  /** Prisma's camelCase delegate name, e.g. `purchaseOrder`. */
  model: string;
  op: string;
  /**
   * The top-level columns the call writes, where the argument is a literal —
   * which is how a co-owner's exception can be held to the columns it owns
   * (PRD #48 §252). Null when the payload is spread, computed or a variable,
   * and an exception scoped to fields then does not apply.
   */
  fields: string[] | null;
};

export function sourceFiles(): string[] {
  const accept = (file: string) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.endsWith(".d.ts");
  return [...walk("lib", accept), ...walk("app", accept), ...walk("scripts", accept)];
}

export function writeSites(files = sourceFiles()): WriteSite[] {
  const sites: WriteSite[] = [];
  for (const file of files) {
    const source = parse(file);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const op = node.expression.name.text;
        const delegate = node.expression.expression;
        if (MUTATIONS.has(op) && ts.isPropertyAccessExpression(delegate)) {
          const root = delegate.expression;
          const clientName = ts.isIdentifier(root) ? root.text : ts.isPropertyAccessExpression(root) ? root.name.text : "";
          if (CLIENTS.has(clientName) && /^[a-z]/.test(delegate.name.text)) {
            sites.push({ file, line: lineOf(source, node), model: delegate.name.text, op, fields: writtenFields(node) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites;
}

/**
 * The columns a mutation names, read off the call's own syntax.
 *
 * `create`/`update` take `data`; `upsert` takes `create` and `update` and
 * writes the union of both. A spread or a variable makes the set unknowable
 * from here, and that is reported as null rather than as an empty set — the
 * difference between "writes nothing" and "writes we cannot see".
 */
function writtenFields(call: ts.CallExpression): string[] | null {
  const argument = call.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) return null;

  const fields = new Set<string>();
  for (const key of ["data", "create", "update"]) {
    const property = argument.properties.find(
      (candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) && candidate.name.text === key,
    );
    if (!property) continue;
    const value = property.initializer;
    // `data: rows.map(…)` — a createMany payload we cannot read statically.
    if (!ts.isObjectLiteralExpression(value)) return null;
    for (const entry of value.properties) {
      if (ts.isSpreadAssignment(entry)) return null;
      const name = entry.name;
      if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) return null;
      fields.add(name.text);
    }
  }
  return [...fields].sort();
}
