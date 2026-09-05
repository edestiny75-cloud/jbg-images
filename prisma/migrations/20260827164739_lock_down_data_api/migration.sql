-- Close the Supabase Data API to the anon role.
--
-- Every table in this database has been reachable over PostgREST with the
-- project's anon key since the beginning: the key was embedded in index.html and
-- committed to git in agent/JBG_Fiery_Agent.ps1, and it carried full read/write
-- on everything. Reproduced against a local Supabase before writing this, a
-- plain `GET /rest/v1/users?select=*` with only that key returned every row of
-- the users table, `pin_hash` and `role` included.
--
-- Two independent locks, because either one alone has a gap:
--
--   1. RLS with no policies. Any query through the Data API matches no rows.
--      NOT forced, deliberately: FORCE ROW LEVEL SECURITY would apply to the
--      table owner too, and the application connects as the owner — forcing it
--      would give the app itself zero rows.
--   2. No grants at all for anon/authenticated, so those roles cannot even see
--      the tables, and ALTER DEFAULT PRIVILEGES so a table added later is not
--      quietly exposed the way every existing one was.
--
-- `service_role` is left alone. It is gated on the secret key, which is not
-- public, and Studio needs it.
--
-- This could only be applied once the Fiery print agent stopped reading the
-- database itself — it now claims work through /api/print-jobs, which is the
-- whole reason that endpoint exists. Applying this to the old agent would have
-- stopped the printer either way, and neither failure announces itself on a shop
-- floor: the revoke answers 42501, which the agent's catch-all logs as one grey
-- line before it goes back to polling, and RLS on its own is worse still — a
-- clean 200 with an empty list, indistinguishable from having no work to do.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
