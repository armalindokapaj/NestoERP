-- Row level security on every table in the public schema.
--
-- NESTO reaches Postgres only through Prisma, as the table owner, which is not
-- subject to row level security. Supabase additionally exposes the public
-- schema over its REST API to the `anon` and `authenticated` roles, and the
-- anon key is public. With RLS off, anyone holding that key could read or
-- rewrite every row, including users and platform_access. With RLS on and no
-- policies, those two roles can read and write nothing.
--
-- Idempotent, and a no-op for the owner's own access, so it is safe on a
-- development database that has no `anon` role. A table added by a later
-- migration needs its own ENABLE ROW LEVEL SECURITY line.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END
$$;
