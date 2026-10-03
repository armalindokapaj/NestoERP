-- Platform Recovery: permanent removal of deleted companies and groups.
-- Deletes every company-scoped row with FK triggers off, then sweeps whatever is left orphaned
-- through every foreign key, so Restrict constraints cannot strand rows. Runs in the caller's
-- transaction: any error rolls the whole purge back. Generalises scripts/db/teardown-armaar.sql.
CREATE OR REPLACE FUNCTION platform_purge_tenants(p_company_ids text[], p_group_ids text[]) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE r record; fk record; n bigint; changed boolean := true; pass int := 0;
BEGIN
  EXECUTE 'SET LOCAL session_replication_role = replica';
  FOR r IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
           WHERE c.table_schema='public' AND c.column_name='companyId' AND c.table_name <> 'companies' LOOP
    EXECUTE format('DELETE FROM %I WHERE "companyId" = ANY($1)', r.table_name) USING p_company_ids;
  END LOOP;
  DELETE FROM companies WHERE id = ANY(p_company_ids);
  DELETE FROM parent_groups WHERE id = ANY(p_group_ids);

  WHILE changed AND pass < 50 LOOP
    changed := false; pass := pass + 1;
    FOR fk IN
      SELECT con.confdeltype, con.conrelid::regclass AS child, con.confrelid::regclass AS parent,
        (SELECT string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ' ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum) AS notnull,
        (SELECT string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' AND ' ORDER BY k.ord)
           FROM unnest(con.conkey) WITH ORDINALITY k(attnum,ord)
           JOIN unnest(con.confkey) WITH ORDINALITY f(attnum,ord) ON f.ord=k.ord
           JOIN pg_attribute ca ON ca.attrelid=con.conrelid AND ca.attnum=k.attnum
           JOIN pg_attribute pa ON pa.attrelid=con.confrelid AND pa.attnum=f.attnum) AS joincond,
        (SELECT string_agg(format('%I = NULL', a.attname), ', ') FROM unnest(con.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum) AS setnull
      FROM pg_constraint con WHERE con.contype='f' AND con.connamespace='public'::regnamespace
    LOOP
      IF fk.confdeltype = 'n' THEN
        EXECUTE format('UPDATE %s c SET %s WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)', fk.child, fk.setnull, fk.notnull, fk.parent, fk.joincond);
      ELSE
        EXECUTE format('DELETE FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)', fk.child, fk.notnull, fk.parent, fk.joincond);
      END IF;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN changed := true; END IF;
    END LOOP;
  END LOOP;
  EXECUTE 'SET LOCAL session_replication_role = origin';
  RETURN pass;
END $$;
