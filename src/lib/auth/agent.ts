import 'server-only';
import { env } from '@/lib/env';
import { bearerMatches } from './bearer';

/**
 * How the Fiery print agent proves who it is.
 *
 * The agent is a PowerShell script on a Windows box beside the printer. It has
 * no browser, no session and no user, so the cookie the rest of the app runs on
 * is no use to it — it presents a shared bearer token instead, and `src/proxy.ts`
 * lets `/api/print-jobs/*` past the session gate so this can be checked here.
 *
 * What it replaces is why it matters: the agent authenticated to Supabase with
 * the *anon key* — the same key the browser held, committed to git at
 * agent/JBG_Fiery_Agent.ps1:65 — which carried full read/write on every table in
 * the database, in order to print a PDF.
 */
export function isAgentRequest(request: Request): boolean {
  return bearerMatches(request.headers.get('authorization'), env.PRINT_AGENT_TOKEN);
}
