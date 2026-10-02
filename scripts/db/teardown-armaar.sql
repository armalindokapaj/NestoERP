-- Removes the ARMAAR demo group's 13 companies (ids armaar_co_*) and everything under them.
-- 1) delete company-scoped rows with FK triggers off, 2) sweep orphans via every FK, 3) verify FKs.
-- One transaction: any error rolls everything back. Needs a role allowed to set session_replication_role.
BEGIN;
SET LOCAL session_replication_role = replica;
DO $$
DECLARE r record; fk record; n bigint; changed boolean := true; pass int := 0; cond text; sel text; cols text;
BEGIN
  FOR r IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
           WHERE c.table_schema='public' AND c.column_name='companyId' AND c.table_name NOT IN ('companies') LOOP
    EXECUTE format('DELETE FROM %I WHERE "companyId" LIKE %L', r.table_name, 'armaar\_co\_%');
  END LOOP;
  DELETE FROM companies WHERE id LIKE 'armaar\_co\_%';
  DELETE FROM parent_groups WHERE id IN (SELECT id FROM parent_groups WHERE name ILIKE 'armaar%');

  WHILE changed AND pass < 50 LOOP
    changed := false; pass := pass + 1;
    FOR fk IN
      SELECT con.oid, con.conrelid::regclass AS child, con.confrelid::regclass AS parent, con.confdeltype,
        (SELECT string_agg(format('c.%I', a.attname), ', ' ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum) AS ccols,
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
  RAISE NOTICE 'sweep passes: %', pass;
END $$;
SET LOCAL session_replication_role = origin;
-- re-enable and validate every FK
DO $$ DECLARE con record; BEGIN
  FOR con IN SELECT conrelid::regclass AS t, conname FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', con.t, con.conname);
  END LOOP;
END $$;
COMMIT;
