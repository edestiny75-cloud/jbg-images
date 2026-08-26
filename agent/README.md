# JBG Fiery Agent

Automates print fulfillment from the JBG Fulfillment app straight through to a fully-configured, held job on the shop's Fiery print server — Copies, Media type/weight, and paper tray all set automatically, nothing to type by hand at release.

Runs as a long-lived PowerShell console window on Sam's shop PC (`C:\Users\Jamsp\OneDrive\Desktop\Cowork\`). This `/agent` folder is a snapshot of that code plus its recent run logs, kept here for reference/history — **the live copy that actually runs lives on the shop PC, not here.** Editing the copy in this repo does nothing; it has to be edited and re-run on the shop PC itself.

## Architecture

```
JBG Fulfillment app (index.html, this same repo)
        │  writes a row per print job
        ▼
Supabase "print_jobs" table  (status: queued → done/error)
        │  polled every 5s
        ▼
JBG_Fiery_Agent.ps1
        │  1. downloads the PDF (Google Cloud Storage or Supabase Storage)
        │  2. drops it into the "JBG Hold" hot folder, filename =
        │     "{SKU}  FID{8-hex-token}  x{copies}  [{size}].pdf"
        ▼
Fiery Hot Folders Console  (watches "JBG Hold", imports natively to the Held queue)
        │
        ▼
JBG_Fiery_Agent.ps1 (same run)
        │  3. logs into the Fiery REST API (https://192.168.1.33/live/api/v3)
        │  4. finds the just-imported job by its unique FID token
        │  5. PUTs "num copies" (if copies > 1)
        │  6. PUTs EFMediaType / EFMediaWeight / InputSlot (based on size)
        │  7. GETs the job back and verifies every value actually stuck
        ▼
Held job in Command WorkStation, fully configured - operator just hits Print
```

The app and this agent talk only through the Supabase `print_jobs` table — the agent doesn't know or care how a job got queued.

### Why the file goes through a hot folder instead of straight to the API

The Fiery REST API has no documented "submit a new job" endpoint for this Fiery/version — only "list job IDs" and "get/modify one job you already know the ID of." So the agent still uses the hot folder (proven, handled by EFI's own software) to get the file onto the Fiery and into the Held queue, then uses the API only to *modify* the job that import already created. This is deliberate, not a workaround waiting to be replaced - it's the only reliable way in given what the API actually exposes.

### Key files

| File | Role |
|---|---|
| `JBG_Fiery_Agent.ps1` | The agent itself - the poll loop, hot-folder drop, and all Fiery API calls. |
| `Start JBG Fiery Agent.bat` | Launcher. **Always use this**, not "Run with PowerShell" on the .ps1 directly - see Device limitations. |
| `Fiery_Dump_Job.ps1` | One-off, read-only diagnostic: logs in and dumps every real attribute Fiery has for one job ID. This is how the real `EFMediaType`/`EFMediaWeight` keys were found (see Known edge cases) - the tool to reach for any time a new Fiery attribute needs automating. |
| `Run Fiery Dump Job.bat` | Launcher for the diagnostic. Same execution-policy reason as above. |
| `logs/` | Snapshot of recent `_Fiery_Logs/agent_*.log` run logs from the shop PC, for reference. The live script keeps its own rolling window of the most recent 30 runs; this folder is not auto-synced. |

Not included here (and never should be): `fiery_credentials.xml` (the encrypted saved login - see below), the actual `JBG Hold` / `_Fiery_Exports` / `_Fiery_Temp` folders (real customer print files), `qpdf/` (a ~10MB third-party binary, currently unused - see Copies mode below).

## Known edge cases / hard-won lessons

- **Fiery's API attribute keys are not what you'd guess, and a PUT/GET round-trip is not proof a setting took effect.** `"num copies"` (lowercase, space-separated) is genuinely correct for Copies - confirmed against Command WorkStation across 5+ real jobs. But the same naming pattern for Media (`"media type"`/`"media weight"`) turned out to be a dead end: Fiery accepted and echoed those keys back on GET, but the real Job Properties > Media panel never changed. The real keys are `EFMediaType` / `EFMediaWeight` / `InputSlot`, and their *values* are internal names, not the GUI label text (e.g. GUI "Coated 3" = `EFMediaType: CoatedExtraheavy`; GUI "Heavyweight 4" = `Heavy4`; GUI "257-300 gsm" = `257_300`). **Rule going forward: for any new attribute, set it by hand in the GUI first, then run `Fiery_Dump_Job.ps1` on that job to read the real key/value off the dump - never guess from the API docs or from naming patterns alone.**

- **Job matching must use a unique token only - no title or SKU fallback.** An earlier version fell back to matching by title text or bare SKU prefix when the token match hadn't found the job yet (e.g. because Fiery hadn't finished importing it). That fallback once matched an unrelated job from months earlier that happened to share the same product SKU, and silently overwrote its Copies field. The fix (now in place): match ONLY on a fresh GUID token embedded in the filename (`FID{8-hex}`), plus a `"held?" = "yes"` sanity check. This is strictly slower to fail (if the token genuinely isn't found yet, it just retries and eventually falls back to manual) but can never touch the wrong job.

- **The `held?` field must be explicitly requested.** Fiery's `/jobs` list endpoint only returns whatever keys you ask for via `?key[]=...` - it does not include `held?` by default even though the docs' own example omits it. Forgetting this made the safety check above silently reject every job, every time.

- **Job status doesn't mean queue.** A job actually sitting in the Held queue reports a `status` like `"done ripping"` - that's the RIP pipeline stage, not "which queue it's in." There is no `status=held` value. Filtering on status would silently discard the exact job being searched for.

- **Session goes stale mid-run.** The Fiery API session can drop after a period of idle time (observed: a session that logged in fine 401'd on its first real use ~6 minutes later). The agent does one silent re-login attempt (using the same in-memory credentials) on any 401 before giving up, so a multi-hour shift doesn't need manual restarts.

- **Multi-page bundles can't safely have their pages duplicated for Copies.** The original idea (`COPIES_MODE = "repeat_pages"`, still in the code, currently unused) built the copy count into the PDF itself by repeating its pages via `qpdf`, so the Fiery would print the right quantity with nothing to set at release. This works fine for 1-2 page files (single posters, duplex A/B maps), but a 3+ page bundle risks the physical finisher stapling all the repeated pages into one oversized block instead of N separate sets. `COPIES_MODE` is set to `"manual"` (meaning: send the file untouched, let the API set Copies) specifically to avoid this risk - do not re-enable `"repeat_pages"` without re-solving the stapling problem first.

- **PJL header injection corrupts jobs on this Fiery.** A third `COPIES_MODE` (`"pjl"`, prepending a `@PJL SET COPIES=` header to the raw PDF bytes) was tried and confirmed to produce broken jobs (unknown page count / no content / wrong media) on this specific Fiery. Kept in the code only as a documented dead end - never use it here.

- **The Automation Key API tier lacks job-listing permission.** Confirmed empirically: an Automation Key logs in successfully but 401s on every `/jobs` call. `Connect-Fiery` now does an immediate self-test against the real jobs endpoint right after login, specifically so this shows up as an immediate, clear failure instead of 15 retries of silent 401s deep into the first real job.

- **Clipboard reads over a remote session can transiently fail.** ("Requested Clipboard operation did not succeed" - seen when accessing this PC via AnyDesk.) `Read-SecretFromClipboard` retries up to 5 times with a short delay before giving up.

## Device limitations

- **Tied to this specific shop PC.** Paths (`$ROOT`, the hot folder, credential file) are all relative to `Split-Path -Parent $MyInvocation.MyCommand.Path` - i.e. wherever `JBG_Fiery_Agent.ps1` actually lives. It's currently `C:\Users\Jamsp\OneDrive\Desktop\Cowork\`. Moving the whole folder is fine; copying just the `.ps1` elsewhere is not - it needs its sibling folders (`JBG Hold`, `_Fiery_Temp`, etc.) alongside it.
- **Saved login (`fiery_credentials.xml`) only works on the PC + Windows account that created it.** It's encrypted via Windows DPAPI, which derives its key from the current Windows user profile - copying that file to another machine or Windows login makes it permanently undecryptable (the agent detects this, deletes the stale file, and re-prompts automatically).
- **Requires the Fiery Hot Folders Console running and the "JBG Hold" folder Active**, with its Job Action set to "Hold" (not "Print" - that would print immediately with no chance to review). The agent drops files but never imports them itself.
- **Requires network access to `192.168.1.33`** (the Fiery server's LAN address) and trusts its self-signed TLS certificate for this process only (`FieryTrustAll`) - deliberately scoped to not weaken certificate validation for anything else on the machine.
- **Currently running on an EFI Evaluation Key** (time-limited, full API access). Before it expires, request a **Production Key** from EFI - the Automation Key tier is confirmed insufficient (see edge cases above). Note: EFI's own description of the Production Key mentions "requires a valid license for each connected Fiery server" - possible added cost, not yet resolved.
- **`qpdf.exe`** (referenced by `$QPDF`, not included in this repo folder) is only needed if `COPIES_MODE` is ever switched back to `"repeat_pages"` - currently unused with `COPIES_MODE = "manual"`.

## Setup / connection steps (fresh machine or reinstall)

1. Copy the whole working folder (not just this `/agent` subfolder - it needs `JBG Hold`, `_Fiery_Exports`, `_Fiery_Temp`, `_Fiery_Logs` alongside the scripts) to the target PC.
2. In Fiery Hot Folders Console, create/point a hot folder named to match `$HOTFOLDER_NAME` (currently `"JBG Hold"`) at that subfolder, with Job Action = **Hold**, and set it Active.
3. Double-click `Start JBG Fiery Agent.bat` (not "Run with PowerShell" on the .ps1 - see below).
4. First run only: enter the Fiery username (default `Administrator`), then copy-paste the Fiery password and API key when prompted (each read from the clipboard, not typed directly, to avoid a stray line-break corrupting the paste). These get encrypted to disk (DPAPI) so this step is skipped on every future run - see `fiery_credentials.xml` above.
5. Confirm the startup banner says `Copies: AUTOMATIC via Fiery API` (not "set at release") - if it says the latter, the API login or its self-test failed; check the console output/log for why.
6. Leave both the agent window and Fiery Hot Folders Console open. Closing the agent window stops job processing (queued jobs just wait until it's restarted).

**Why the `.bat` launcher instead of just running the `.ps1`:** Windows' default PowerShell execution policy blocks bare `.ps1` scripts from the right-click "Run with PowerShell" menu - the window flashes open and closed instantly with no visible error. The `.bat` files call `powershell -ExecutionPolicy Bypass -File ...`, which only relaxes the policy for that one launched process, not system-wide.

To reset a broken saved login: delete `fiery_credentials.xml` from the working folder and restart the agent - it will prompt fresh and re-save.
