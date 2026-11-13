/**
 * The selling demo's prose rewrite, as SQL (apply.ts runs it).
 */

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const regexEscaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One statement that rewrites every text and JSON column of the database
 * through the replacements — except identifiers, keys, hashes, storage paths
 * and URLs, which point at things (a stored file, a signed link) and must not
 * move. Only rows holding an old name are touched.
 */
export function proseReplacementSql(pairs: ReadonlyArray<{ old: string; new: string; word?: boolean }>): string {
  let template = "%1$s";
  for (const pair of pairs) {
    template = pair.word
      ? `regexp_replace(${template}, ${literal(`\\m${regexEscaped(pair.old)}\\M`)}, ${literal(pair.new)}, 'g')`
      : `replace(${template}, ${literal(pair.old)}, ${literal(pair.new)})`;
  }
  const filter = pairs.map((pair) => regexEscaped(pair.old)).join("|");
  return `
DO $showcase$
DECLARE
  col record;
  target text;
BEGIN
  FOR col IN
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
      AND c.column_name !~* '(^id$|id$|ids$|key$|hash|token|checksum|slug|password|mime|extension|bucket|provider|path|url$|etag|signature|username)'
      AND c.table_name !~ '^_prisma'
  LOOP
    target := CASE WHEN col.data_type IN ('jsonb', 'json') THEN format('%I::text', col.column_name) ELSE format('%I', col.column_name) END;
    EXECUTE format(
      'UPDATE %I SET %I = (%s)%s WHERE %s ~ %L',
      col.table_name, col.column_name, format(${literal(template)}, target),
      CASE col.data_type WHEN 'jsonb' THEN '::jsonb' WHEN 'json' THEN '::json' ELSE '' END,
      target, ${literal(filter)}
    );
  END LOOP;
END
$showcase$;`;
}
