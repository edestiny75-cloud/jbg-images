# ============================================================
#  JBG Fiery Agent  (drops files into the Fiery HOT FOLDER)
#  Claims POSTER print jobs from the fulfillment app, downloads each
#  print file, and drops it into your Fiery "JBG Hold" hot folder. The
#  Fiery Hot Folders app imports it natively to the Held queue - clean
#  pages, content, and media every time.
#
#  FNSKU label jobs are ignored here - those go to your label printer.
#
#  >>> RUN:  double-click  Start JBG Fiery Agent.bat
#  Also keep the Fiery Hot Folders Console running (it does the import).
#  Leave both open. Close this window to stop the agent.
# ============================================================

# ---- Your Fiery hot folder (created in Fiery Hot Folders Console) ----
$HOTFOLDER_NAME = "JBG Hold"   # the hot folder's name (a subfolder of this Cowork folder)
$POLL_SECONDS   = 5

# ---- Fiery API (sets real Copies on multi-page bundle jobs that repeat_pages skips) ----
#   $false (default): off. Bundles keep falling back to "manual - set Copies at release", same as today.
#   $true : on. At startup you'll be prompted for your Fiery username, password, and API key
#           (the "accessrights" key from the EFI API request form) - typed by YOU into this
#           console window, never stored in this file, never sent anywhere but the Fiery itself.
#   Test this on one low-stakes bundle job before trusting it on a real order.
$FIERY_API_ENABLED = $true
$FIERY_HOST         = "192.168.1.33"
$FIERY_DEFAULT_USER = "Administrator"

# ---- Copies handling ----
#   "repeat_pages" : duplicate the file's pages `copies` times before dropping it in (via qpdf).
#                    A 1-page poster x4 becomes a clean 4-page file; a 2-page duplex map x3 becomes
#                    a correctly-paired 6-page file (A,B,A,B,A,B). The Fiery just prints one sheet
#                    per page - nobody has to touch the Copies field at release. DEFAULT / RECOMMENDED.
#   "manual"       : send the file untouched; type the count into the Fiery Copies field at release
#                    (the count is in the job title). Falls back to this automatically if qpdf is missing.
#   "pjl"          : DO NOT USE on this Fiery - confirmed to corrupt jobs (Unknown pages/no content,
#                     wrong media). Kept only for reference / a different Fiery in future.
$COPIES_MODE = "manual"

# ---- Media (paper) settings per print size - set automatically via Fiery API, same mechanism
#      as Copies above. Maps the job's size (the $size field the app already sends, e.g. "11x17"
#      or "8.5x11") to the attributes Sam otherwise has to pick by hand in Job Properties > Media
#      at release.
#   IMPORTANT: "media type"/"media weight" (lowercase, matching the "num copies" pattern) turned
#   out to be a dead end - Fiery accepts and echoes those keys back on GET, but Command WorkStation's
#   actual Media panel doesn't read from them, so a PUT/GET "verified" there was worthless proof
#   (confirmed 2026-08-25 - GUI showed no change after the "verified" PUT). The REAL keys, found by
#   having Sam set Media by hand in the GUI and dumping the job's full attributes right after
#   (Fiery_Dump_Job.ps1), are EFMediaType / EFMediaWeight - and their values are internal names, NOT
#   the same text as the GUI dropdown label (e.g. the "Coated 3" label is internally "CoatedExtraheavy").
#   8.5x11 binder inserts also need a specific input tray (InputSlot=Tray3); 11x17 posters use
#   whatever tray is auto-selected, so no InputSlot override for that size.
$FIERY_SET_MEDIA = $true
$FIERY_MEDIA_BY_SIZE = @{
  "11x17"  = @{ EFMediaType = "CoatedExtraheavy"; EFMediaWeight = "257_300" }
  "8.5x11" = @{ EFMediaType = "Heavy4";           EFMediaWeight = "257_300"; InputSlot = "Tray3" }
}

# ---- The app (hands out work, takes the result back) ----
#   This used to be the Supabase URL and the project's anon key, pasted straight
#   into this file - a key that granted full read/write on EVERY table in the
#   database, to a script whose job is to copy a PDF into a folder. It is in this
#   file's git history and is being rotated.
#
#   Now the agent asks the app for work and tells the app what happened, over two
#   endpoints, with a token that is good for nothing else. The token is not in
#   this file: it is typed in once and saved encrypted to this Windows login,
#   the same way the Fiery password already is.
#
#   Where the print files live is no longer configured here either - the app
#   sends a finished URL with each job. That base URL used to be written down in
#   two places (here and in the app), which meant it could drift in one of them.
$APP_URL    = if ($env:JBG_APP_URL)    { $env:JBG_APP_URL.TrimEnd('/') } else { "https://CHANGE-ME.example.com" }
$AGENT_NAME = if ($env:JBG_AGENT_NAME) { $env:JBG_AGENT_NAME }          else { $env:COMPUTERNAME }
# ------------------------------------------------------------

$ROOT      = Split-Path -Parent $MyInvocation.MyCommand.Path
$HOTFOLDER = Join-Path $ROOT $HOTFOLDER_NAME
$FALLBACK  = Join-Path $ROOT "_Fiery_Exports"
$TEMP      = Join-Path $ROOT "_Fiery_Temp"
$QPDF      = Join-Path $ROOT "qpdf\qpdf.exe"   # tiny PDF tool that builds the copy count into the file
New-Item -ItemType Directory -Force -Path $TEMP | Out-Null
# $script:AppHeaders is built once the agent token has been loaded, below.

# ---- Run logging (for debugging) -------------------------------------------
#  Every line the agent prints is ALSO appended, with a timestamp, to a dated
#  log file under _Fiery_Logs (nothing on screen changes). Old logs are trimmed
#  to the most recent 30 runs so the folder can't grow without bound. When
#  something misbehaves, open the newest agent_*.log in _Fiery_Logs to see
#  exactly what happened and when.
$script:LogDir = Join-Path $ROOT "_Fiery_Logs"
New-Item -ItemType Directory -Force -Path $script:LogDir | Out-Null
try {
  Get-ChildItem $script:LogDir -Filter "agent_*.log" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 |
    Remove-Item -Force -ErrorAction SilentlyContinue
} catch {}
$script:LogFile = Join-Path $script:LogDir ("agent_{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))

function Emit {
  param([Parameter(Position=0)][string]$Message = "", [string]$ForegroundColor)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  try { Add-Content -LiteralPath $script:LogFile -Value $line -ErrorAction SilentlyContinue } catch {}
  if ($PSBoundParameters.ContainsKey('ForegroundColor') -and $ForegroundColor) {
    Write-Host $Message -ForegroundColor $ForegroundColor
  } else {
    Write-Host $Message
  }
}
Emit ""
Emit ("==== JBG Fiery Agent run started {0} ====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")) -ForegroundColor DarkGray
Emit ("     log file: {0}" -f $script:LogFile) -ForegroundColor DarkGray
# ----------------------------------------------------------------------------

# ---- Prepend a PJL "SET COPIES" header so the Fiery fills the job's COPIES field on import,
#      while the PDF keeps its true page count (two-sided maps stay 2 pages = one duplex sheet).
#      Returns the path to drop (the original if copies <= 1). ----
function Add-PjlCopies($srcPdf, $copies, $tag) {
  if ($copies -le 1) { return $srcPdf }
  $ascii = [System.Text.Encoding]::ASCII
  $UEL   = [string]([char]27) + "%-12345X"
  $hdr   = $ascii.GetBytes($UEL + "@PJL`r`n@PJL SET COPIES=$copies`r`n" + $UEL)
  $pdf   = [System.IO.File]::ReadAllBytes($srcPdf)
  $out   = Join-Path $TEMP ("pjl_{0}.pdf" -f $tag)
  $fs    = [System.IO.File]::Create($out)
  try { $fs.Write($hdr, 0, $hdr.Length); $fs.Write($pdf, 0, $pdf.Length) } finally { $fs.Close() }
  return $out
}

# ---- Repeat the file's pages `copies` times via qpdf (e.g. 2-page duplex map x3 -> 6 pages,
#      A,B,A,B,A,B - pairing stays correct). Falls back to the untouched file if qpdf is missing
#      or errors, so a job never gets silently dropped. ----
function Add-RepeatedPages($srcPdf, $copies, $tag) {
  if ($copies -le 1) { return $srcPdf }
  if (-not (Test-Path $QPDF)) { return $srcPdf }
  $out = Join-Path $TEMP ("rep_{0}.pdf" -f $tag)
  $qargs = @("--empty", "--pages")
  for ($i = 0; $i -lt $copies; $i++) { $qargs += $srcPdf; $qargs += "1-z" }
  $qargs += @("--", $out)
  & $QPDF @qargs | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) { return $srcPdf }
  return $out
}

# ---- Page count of a PDF via qpdf. Returns -1 if it can't be read (treated as "unsafe to touch"). ----
function Get-PageCount($pdf) {
  if (-not (Test-Path $QPDF)) { return -1 }
  $n = & $QPDF --show-npages $pdf 2>$null
  if ($LASTEXITCODE -ne 0) { return -1 }
  return [int]$n
}

# ---- Multi-page bundles/binders (3+ pages) may get physically stapled/finished as one set on
#      release. Repeating their pages would blur where one set ends and the next begins (e.g. a
#      13-page bundle x6 could staple as one 78-page block instead of 6 separate 13-page sets).
#      Single posters (1 page) and duplex maps (2 pages: Side A/B) are unaffected and stay automatic.
#      Anything above this must wait for the Fiery-API copies fix - falls back to manual for now. ----
$REPEAT_PAGES_MAX_SRC_PAGES = 2

# ================= Fiery API (live jobs, real Copies field) =================
# The Fiery uses a self-signed cert - .NET refuses it by default. This trusts it
# for THIS process only (a compiled callback, not a scriptblock - those can't run
# on the background thread .NET uses for TLS validation).
Add-Type @"
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public static class FieryTrustAll {
  public static void Apply() {
    ServicePointManager.ServerCertificateValidationCallback =
      delegate(object s, X509Certificate c, X509Chain ch, SslPolicyErrors e) { return true; };
  }
}
"@
$script:FierySession = $null
# Credentials kept in memory (SecureString only, never written to disk or logged) so the agent can
# silently re-authenticate if the Fiery session goes stale mid-run (e.g. a short idle timeout) -
# without interrupting whoever's watching the console with another credential prompt.
$script:FieryUser = $null
$script:FieryPassSecure = $null
$script:FieryKeySecure = $null

function Connect-Fiery($user, $securePw, $secureKey) {
  [FieryTrustAll]::Apply()
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  $pw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw))
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey))
  $body = @{ username = $user; password = $pw; accessrights = $key } | ConvertTo-Json
  try {
    # -SessionVariable builds a real cookie jar (parses each Set-Cookie into name/value/domain/path
    # correctly) instead of us manually grabbing the raw Set-Cookie header text and replaying it -
    # that raw text includes attributes like Path=/; HttpOnly which a bare Cookie header can't carry,
    # which is why login succeeded but every call afterward got 401.
    $resp = Invoke-WebRequest -Uri "https://$FIERY_HOST/live/api/v3/login" -Method Post -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 15 -SessionVariable fierySess
    # Fiery can return HTTP 200 with a cookie even on a REJECTED login - it marks the real
    # result in the JSON body ("authenticated":false). A cookie alone doesn't mean success.
    $parsed = $null
    try { $parsed = $resp.Content | ConvertFrom-Json } catch {}
    if ($parsed -and ($parsed.PSObject.Properties.Name -contains 'authenticated') -and -not $parsed.authenticated) {
      $why = if ($parsed.errors) { $parsed.errors } else { "authenticated=false in response" }
      Emit "  ! Fiery API login REJECTED: $why" -ForegroundColor Red
      return $false
    }
    $gotCookies = $fierySess.Cookies.GetCookies("https://$FIERY_HOST/").Count -gt 0
    if (-not $gotCookies) { Emit "  ! Fiery API login: no session cookie returned - check the API key/password" -ForegroundColor Red; return $false }
    # A cookie existing isn't proof the session can do what we actually need. Test the REAL endpoint
    # (job listing) right now, immediately - not the first time a real job needs it 15 retries later.
    # A key that logs in fine but lacks permission for this specific endpoint would otherwise show
    # a false "logged in" success and only fail later, deep into a job's processing.
    try {
      $testResp = Invoke-WebRequest -Uri "https://$FIERY_HOST/live/api/v3/jobs?key[]=id" -WebSession $fierySess -Method Get -UseBasicParsing -TimeoutSec 15
      if ([int]$testResp.StatusCode -ne 200) {
        Emit "  ! Fiery API: login accepted for $user, but the jobs endpoint returned HTTP $([int]$testResp.StatusCode) - this key/session can't do job lookups. Automatic Copies staying OFF; falling back to manual." -ForegroundColor Red
        return $false
      }
    } catch {
      Emit "  ! Fiery API: login accepted for $user, but a real jobs-endpoint test failed ($($_.Exception.Message)) - this key/session can't do job lookups. Automatic Copies staying OFF; falling back to manual." -ForegroundColor Red
      return $false
    }
    $script:FierySession = $fierySess
    $script:FieryUser = $user
    $script:FieryPassSecure = $securePw
    $script:FieryKeySecure = $secureKey
    Emit "  Fiery API: connected as $user (job access confirmed)." -ForegroundColor Green
    return $true
  } catch {
    Emit "  ! Fiery API login failed: $($_.Exception.Message)" -ForegroundColor Red
    return $false
  } finally {
    $pw = $null; $key = $null   # don't linger in memory longer than needed
  }
}

# If a job-lookup or copies-set call comes back 401 mid-run, the session may have simply gone
# stale (idle timeout) rather than the key being wrong - it logged in successfully at startup.
# Try exactly one silent re-login with the same credentials (kept in memory as SecureString,
# never written to disk) before giving up, so a multi-hour run doesn't need manual restarting
# every time the Fiery drops the session.
function Reconnect-Fiery {
  if (-not $script:FieryUser -or -not $script:FieryPassSecure -or -not $script:FieryKeySecure) { return $false }
  Emit "  (Fiery session looks stale - attempting one silent re-login...)" -ForegroundColor DarkGray
  return (Connect-Fiery $script:FieryUser $script:FieryPassSecure $script:FieryKeySecure)
}

# Find a Held job whose title contains $titleFragment (our "SKU  x6  [size]" naming), or failing
# that, just the SKU prefix (Fiery may reformat/collapse whitespace on import, dropping the exact
# "x{N}  [size]" part we put in the filename). Import isn't instant after the hot-folder drop, so
# this polls briefly. If nothing matches after all tries, logs the actual job names Fiery returned
# so the matching logic can be corrected against real data instead of guesswork.
function Find-FieryHeldJob($titleFragment, $skuPrefix, $token, $maxTries = 15, $delaySec = 1) {
  $lastItems = $null
  $lastRawResp = $null
  $lastStatus = $null
  $lastRawBody = $null
  $sawAnyResponse = $false
  $reconnectTried = $false
  for ($i = 0; $i -lt $maxTries; $i++) {
    try {
      # Per Fiery's own API docs (fieryapi/fiery-api-docs, GET /jobs/:id): "Available job IDs can
      # be retrieved via GET /live/api/v*/jobs?key[]=id" - that's the real, documented mechanism.
      # Our earlier attempts (bare /jobs, and an invalid ?in=held guess) never used it, which is
      # almost certainly why they came back empty. Requesting id/title/name/status explicitly
      # rather than assuming a default response shape.
      # Using Invoke-WebRequest (not Invoke-RestMethod) so we can see the real status code and raw
      # body text, not just whatever PowerShell decided to deserialize it into.
      # NOTE: "held?" (URL-encoded as held%3F below) must be requested explicitly or it never comes
      # back at all - the matching code checks it, and an always-missing field meant the "yes" check
      # below silently failed for every job, no matter how correct the token match was.
      $webResp = Invoke-WebRequest -Uri "https://$FIERY_HOST/live/api/v3/jobs?key[]=id&key[]=title&key[]=name&key[]=status&key[]=held%3F" -WebSession $script:FierySession -Method Get -UseBasicParsing -TimeoutSec 15
      $sawAnyResponse = $true
      $lastStatus = [int]$webResp.StatusCode
      $lastRawBody = $webResp.Content
      $resp = $null
      if (-not [string]::IsNullOrWhiteSpace($lastRawBody)) { try { $resp = $lastRawBody | ConvertFrom-Json } catch {} }
      $lastRawResp = $resp
      # Confirmed from real data: this endpoint returns a BARE array, not {items:[...]} or {jobs:[...]}.
      # Checking $resp -is [array] FIRST matters - PowerShell's member-enumeration makes $resp.items
      # on a bare array return one $null per element (since array items don't have an "items"
      # property), and a non-empty array of nulls is still truthy, so the old property-presence
      # check silently took the wrong branch and searched a list of nothing.
      $items = if ($resp -is [array]) { $resp }
               elseif ($resp.PSObject.Properties.Name -contains 'items') { $resp.items }
               elseif ($resp.PSObject.Properties.Name -contains 'jobs') { $resp.jobs }
               else { @($resp) }
      # No status filtering: confirmed from real data that a job sitting in the Held queue still
      # reports status like "done ripping" (that describes the RIP pipeline stage, not the queue
      # it's parked in - there's no "held" status value here). Filtering on it silently threw away
      # every job, including the exact one we wanted. We already match on a unique token, so there's
      # no ambiguity risk from just searching the full job list.
      $lastItems = @($items)
      # SAFETY FIX (confirmed necessary by direct testing 2026-08-25): the title/SKU fallbacks below
      # used to run when the token match failed, and one of them matched an unrelated job from
      # MONTHS earlier (same SKU, long since printed) - then wrote a new Copies value onto that old
      # job's record. Matching by anything less specific than the unique token is unsafe: any prior
      # job sharing the same SKU or title text is a candidate for silent, wrong modification. Only
      # the token can never collide with another job, so it's now the only thing we match on.
      $match = $null
      if ($token) {
        $match = $items | Where-Object {
          ("$($_.name)|$($_.title)|$($_.jobTitle)") -like "*$token*" -and "$($_.'held?')" -eq 'yes'
        } | Select-Object -First 1
      }
      if ($match) { return $match }
    } catch {
      $errMsg = $_.Exception.Message
      Emit "  ! Fiery API job lookup error: $errMsg" -ForegroundColor Yellow
      # Only try this once per Find-FieryHeldJob call, not once per retry - a genuinely bad
      # key/session would otherwise hammer the login endpoint up to $maxTries times in a row.
      if (-not $reconnectTried -and $errMsg -match '401') {
        $reconnectTried = $true
        if (Reconnect-Fiery) { Emit "  (reconnected - retrying job lookup)" -ForegroundColor DarkGray }
      }
    }
    Start-Sleep -Seconds $delaySec
  }
  if ($sawAnyResponse) {
    Emit "  (Fiery job query: HTTP $lastStatus, $($lastItems.Count) total job(s) on server after $maxTries tries)" -ForegroundColor DarkGray
    # Only show jobs whose title actually contains our token - there should be exactly one (or
    # zero, if it genuinely never imported in time). Dumping all ~1000 historical jobs every time
    # is unusable noise; this narrows straight to what's actually relevant to this failure.
    if ($token) {
      $near = $lastItems | Where-Object { ("$($_.name)|$($_.title)|$($_.jobTitle)") -like "*$token*" }
      if ($near) {
        foreach ($j in $near) { Emit ("    TOKEN FOUND but rejected: id='{0}' title='{1}' held?='{2}'" -f $j.id, $j.title, $j.'held?') -ForegroundColor Red }
      } else {
        Emit "    (no job on the server contains token '$token' yet - it likely hasn't finished importing)" -ForegroundColor DarkGray
      }
    }
    $bodyShown = if ([string]::IsNullOrWhiteSpace($lastRawBody)) { "<empty - server returned no body at all>" } else { "<omitted - $($lastItems.Count) jobs, see token match above>" }
    Emit "  (raw body: $bodyShown)" -ForegroundColor DarkGray
  } else {
    Emit "  (every job-lookup attempt threw an error - see above - never got a response to inspect)" -ForegroundColor DarkGray
  }
  return $null
}

# Set the real Copies field on a held job via the API.
#
# CONFIRMED CORRECT (2026-08-25): "num copies" is genuinely the right attribute. An earlier test
# seemed to show otherwise, but that was reading/writing an unrelated OLD job (a title/SKU matching
# fallback grabbed a months-old already-printed job with the same product name - fallback removed,
# see Find-FieryHeldJob, now token-only). With matching fixed, five separate live jobs were checked
# directly in Command WorkStation's Held queue: Pages and Copies both matched exactly what was
# requested every time (e.g. a 13-page bundle showed Pages=13, Copies=50, not merged/duplicated).
# Still logging the full attribute dump alongside the read-back check for ongoing visibility.
function Set-FieryJobCopies($jobId, $copies, [switch]$IsRetry) {
  try {
    $body = @{ attributes = @{ "num copies" = $copies } } | ConvertTo-Json
    Invoke-RestMethod -Uri "https://$FIERY_HOST/live/api/v3/jobs/$jobId" -WebSession $script:FierySession -Method Put -ContentType "application/json" -Body $body -TimeoutSec 15 | Out-Null
  } catch {
    $errMsg = $_.Exception.Message
    Emit "  ! Fiery API set-copies failed for job $jobId : $errMsg" -ForegroundColor Yellow
    if (-not $IsRetry -and $errMsg -match '401' -and (Reconnect-Fiery)) {
      return (Set-FieryJobCopies $jobId $copies -IsRetry)
    }
    return $false
  }
  # Pull EVERY attribute Fiery has for this job (no key[] filter = full attribute set per the docs)
  # so we have complete visibility on the ACTUAL job just modified, for cross-checking against
  # Command WorkStation - not just the one "num copies" key.
  $full = $null
  try {
    $full = Invoke-RestMethod -Uri "https://$FIERY_HOST/live/api/v3/jobs/$jobId" -WebSession $script:FierySession -Method Get -TimeoutSec 15
  } catch {
    Emit "  ! couldn't pull attributes for job $jobId : $($_.Exception.Message)" -ForegroundColor DarkGray
  }
  $actual = if ($full) { $full."num copies" } else { $null }
  if ("$actual" -eq "$copies") {
    Emit ("  (verified: job {0} - num pages={1}, num copies={2})" -f $jobId, $full.'num pages', $actual) -ForegroundColor Green
    return $true
  }
  Emit "  ! Fiery API set-copies NOT verified for job $jobId - asked for $copies, API reports 'num copies'='$actual'. Full attributes: $($full | ConvertTo-Json -Depth 6 -Compress)" -ForegroundColor Red
  return $false
}

# Same PUT-then-GET-verify pattern as Set-FieryJobCopies above, applied to Media. Takes a hashtable
# of real Fiery attribute keys (EFMediaType / EFMediaWeight / InputSlot - see $FIERY_MEDIA_BY_SIZE)
# so the same function covers both sizes even though 8.5x11 needs one more key (InputSlot) than
# 11x17 does. A mismatch logs the full attribute set, same as the copies function does.
function Set-FieryJobMedia($jobId, $attrs, [switch]$IsRetry) {
  try {
    $body = @{ attributes = $attrs } | ConvertTo-Json
    Invoke-RestMethod -Uri "https://$FIERY_HOST/live/api/v3/jobs/$jobId" -WebSession $script:FierySession -Method Put -ContentType "application/json" -Body $body -TimeoutSec 15 | Out-Null
  } catch {
    $errMsg = $_.Exception.Message
    Emit "  ! Fiery API set-media failed for job $jobId : $errMsg" -ForegroundColor Yellow
    if (-not $IsRetry -and $errMsg -match '401' -and (Reconnect-Fiery)) {
      return (Set-FieryJobMedia $jobId $attrs -IsRetry)
    }
    return $false
  }
  $full = $null
  try {
    $full = Invoke-RestMethod -Uri "https://$FIERY_HOST/live/api/v3/jobs/$jobId" -WebSession $script:FierySession -Method Get -TimeoutSec 15
  } catch {
    Emit "  ! couldn't pull attributes for job $jobId : $($_.Exception.Message)" -ForegroundColor DarkGray
  }
  $mismatches = @()
  foreach ($k in $attrs.Keys) {
    $actual = if ($full) { $full.$k } else { $null }
    if ("$actual" -ne "$($attrs[$k])") { $mismatches += "$k`: wanted '$($attrs[$k])', got '$actual'" }
  }
  if ($mismatches.Count -eq 0) {
    $summary = ($attrs.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ', '
    Emit ("  (verified: job {0} - {1})" -f $jobId, $summary) -ForegroundColor Green
    return $true
  }
  Emit "  ! Fiery API set-media NOT verified for job $jobId - $($mismatches -join '; '). Full attributes: $($full | ConvertTo-Json -Depth 6 -Compress)" -ForegroundColor Red
  return $false
}

# Reads a secret from the clipboard instead of typing/pasting into the console prompt directly -
# a paste containing a stray line break can submit early at Read-Host and corrupt what's captured
# (this is what caused the earlier 12.98 MB login request). Reading the whole clipboard at once
# sidesteps that: any line breaks get joined and all whitespace stripped. Clipboard is cleared
# right after so the secret doesn't sit there for other apps to read.
function Read-SecretFromClipboard($label) {
  Read-Host "  Copy your $label, then press Enter here" | Out-Null
  # Clipboard access on Windows (especially over a remote session like AnyDesk) can transiently
  # fail with "Requested Clipboard operation did not succeed" - retry a few times before giving up.
  $raw = $null
  for ($try = 1; $try -le 5; $try++) {
    try { $raw = Get-Clipboard -Raw -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 300 }
  }
  try { Set-Clipboard -Value ' ' -ErrorAction SilentlyContinue } catch {}
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Emit "  ! clipboard read failed or was empty after 5 tries - try copying it again and re-run" -ForegroundColor Red
    return $null
  }
  $lineCount = @($raw -split "`r?`n").Count
  $clean = ($raw -replace '\s+', '')
  if ($lineCount -gt 1) { Emit "  (clipboard had $lineCount line(s) - joined into one, whitespace stripped, $($clean.Length) characters)" -ForegroundColor DarkGray }
  else { Emit "  ($($clean.Length) characters)" -ForegroundColor DarkGray }
  return (ConvertTo-SecureString $clean -AsPlainText -Force)
}

$FieryCredFile = Join-Path $ROOT "fiery_credentials.xml"

# Saved with Export-Clixml, which runs SecureString fields through Windows DPAPI - the file on
# disk is ciphertext tied to THIS Windows user account + THIS machine. It can't be decrypted by
# copying it elsewhere (a different PC, a different Windows login, even a different user on the
# same PC). Still a step down from "never touches disk" - if this PC is shared or the OneDrive
# folder syncs somewhere unexpected, wipe the file (delete it, or run with -ResetFieryLogin) to
# force a fresh prompt.
function Save-FieryCredentials($user, $securePw, $secureKey) {
  try {
    [PSCustomObject]@{ User = $user; Pass = ($securePw | ConvertFrom-SecureString); Key = ($secureKey | ConvertFrom-SecureString) } |
      Export-Clixml -LiteralPath $FieryCredFile
  } catch { Emit "  ! couldn't save Fiery credentials to disk: $($_.Exception.Message)" -ForegroundColor Yellow }
}

function Load-FieryCredentials {
  if (-not (Test-Path -LiteralPath $FieryCredFile)) { return $null }
  try {
    $saved = Import-Clixml -LiteralPath $FieryCredFile
    return [PSCustomObject]@{
      User = $saved.User
      Pass = ($saved.Pass | ConvertTo-SecureString)
      Key  = ($saved.Key  | ConvertTo-SecureString)
    }
  } catch {
    Emit "  ! saved Fiery credentials couldn't be read (moved to a different PC/login?) - will re-prompt." -ForegroundColor Yellow
    return $null
  }
}

$AgentTokenFile = Join-Path $ROOT "jbg_agent_token.xml"

# Stored exactly like the Fiery credentials above - Export-Clixml runs the
# SecureString through Windows DPAPI, so the file on disk is ciphertext tied to
# THIS Windows login on THIS machine and is useless if copied elsewhere. Delete
# it to be asked for the token again.
function Save-AgentToken($secureToken) {
  try {
    [PSCustomObject]@{ Token = ($secureToken | ConvertFrom-SecureString) } | Export-Clixml -LiteralPath $AgentTokenFile
  } catch { Emit "  ! couldn't save the agent token to disk: $($_.Exception.Message)" -ForegroundColor Yellow }
}

function Load-AgentToken {
  # An environment variable wins, so a test run can point at a dev machine
  # without disturbing the saved production token.
  if ($env:JBG_AGENT_TOKEN) { return (ConvertTo-SecureString $env:JBG_AGENT_TOKEN -AsPlainText -Force) }
  if (-not (Test-Path -LiteralPath $AgentTokenFile)) { return $null }
  try {
    return ((Import-Clixml -LiteralPath $AgentTokenFile).Token | ConvertTo-SecureString)
  } catch {
    Emit "  ! the saved agent token couldn't be read (moved to a different PC/login?) - will re-prompt." -ForegroundColor Yellow
    return $null
  }
}

# Tell the app what became of a job this agent claimed. One of:
#   done     - the file is in the hot folder
#   error    - it cannot be printed; the message is shown on the Print Jobs screen
#   requeue  - not this agent's fault, put it back for the next poll
#
# Each report is wrapped on its own. The old code let a failed PATCH throw into
# the loop's outer catch, which abandoned every remaining job in that batch.
function Complete-Job($id, $outcome, $message) {
  $body = @{ agent = $AGENT_NAME; outcome = $outcome }
  if ($message) { $body["message"] = $message }
  try {
    Invoke-RestMethod -Uri "$APP_URL/api/print-jobs/$id/complete" -Headers $script:AppHeaders `
      -Method Post -ContentType "application/json" -Body ($body | ConvertTo-Json -Compress) -TimeoutSec 30 | Out-Null
    return $true
  } catch {
    Emit "  ! couldn't tell the app that job $id was '$outcome': $($_.Exception.Message)" -ForegroundColor Yellow
    return $false
  }
}

if ($FIERY_API_ENABLED) {
  Emit ""
  $saved = Load-FieryCredentials
  if ($saved) {
    Emit "  Fiery API is ON - using saved login for $($saved.User) (delete fiery_credentials.xml next to this script to clear it)." -ForegroundColor Cyan
    $FIERY_API_ENABLED = Connect-Fiery $saved.User $saved.Pass $saved.Key
    if (-not $FIERY_API_ENABLED) {
      Emit "  ! saved credentials didn't work (expired key/changed password?) - clearing them and asking fresh." -ForegroundColor Yellow
      Remove-Item -LiteralPath $FieryCredFile -Force -ErrorAction SilentlyContinue
      $saved = $null
    }
  }
  if (-not $saved) {
    Emit "  Fiery API is ON - copy each value, then press Enter here. Read from the clipboard, then saved to disk (encrypted to your Windows login) so you won't be asked again." -ForegroundColor Cyan
    $fieryUser   = Read-Host "  Fiery username [$FIERY_DEFAULT_USER]"
    if ([string]::IsNullOrWhiteSpace($fieryUser)) { $fieryUser = $FIERY_DEFAULT_USER }
    $fieryPass   = Read-SecretFromClipboard "Fiery password"
    $fieryApiKey = Read-SecretFromClipboard "Fiery API key (accessrights)"
    if (-not $fieryPass -or -not $fieryApiKey) {
      Emit "  ! missing password or API key - continuing WITHOUT Fiery API." -ForegroundColor Yellow
      $FIERY_API_ENABLED = $false
    } else {
      $FIERY_API_ENABLED = Connect-Fiery $fieryUser $fieryPass $fieryApiKey
      if ($FIERY_API_ENABLED) { Save-FieryCredentials $fieryUser $fieryPass $fieryApiKey }
    }
    $fieryPass = $null; $fieryApiKey = $null
  }
  if (-not $FIERY_API_ENABLED) { Emit "  Continuing WITHOUT Fiery API - bundles will fall back to manual, same as before." -ForegroundColor Yellow }
}
# ================================================================================

# ================================================================================
#  The app connection. Checked HERE, at startup, rather than discovered later:
#  a wrong address or a bad token means nothing prints, and the failure a shop
#  floor notices is "the printer stopped", hours after the cause.
# ================================================================================
if ($APP_URL -like "*CHANGE-ME*") {
  Emit ""
  Emit "  ! The app address hasn't been set." -ForegroundColor Red
  Emit "    Edit \$APP_URL near the top of this file (or set JBG_APP_URL) and run this again." -ForegroundColor Red
  Read-Host "  Press Enter to close"
  exit 1
}

$script:AgentToken = Load-AgentToken
if (-not $script:AgentToken) {
  Emit ""
  Emit "  This agent needs its print token - ask whoever runs the app for it." -ForegroundColor Cyan
  Emit "  Copy it, then press Enter here. It is saved encrypted to your Windows login, so you are only asked once." -ForegroundColor Cyan
  $script:AgentToken = Read-SecretFromClipboard "print agent token"
  if (-not $script:AgentToken) {
    Emit "  ! no token - nothing can be claimed, so nothing would print. Stopping." -ForegroundColor Red
    Read-Host "  Press Enter to close"
    exit 1
  }
  Save-AgentToken $script:AgentToken
}

# Not the Marshal::PtrToStringAuto idiom Connect-Fiery uses a few functions up:
# "Auto" resolves to the ANSI reader outside Windows, which truncates a BSTR at
# its first null byte and yields a one-character token. That difference cannot
# show up on the shop floor, but it does make this line impossible to test
# anywhere else, and this line is the one that decides whether anything prints.
$script:AppHeaders = @{
  Authorization = "Bearer " + [System.Net.NetworkCredential]::new('', $script:AgentToken).Password
}

# A read-only probe: it reports what is waiting without claiming any of it, so
# a bad token is a loud message on line one instead of an empty poll forever.
try {
  $hello = Invoke-RestMethod -Uri "$APP_URL/api/print-jobs/claim" -Headers $script:AppHeaders -Method Get -TimeoutSec 20
  Emit ""
  Emit ("  Connected to {0} as '{1}' - {2} job(s) waiting." -f $APP_URL, $AGENT_NAME, $hello.queued) -ForegroundColor Green
} catch {
  $code = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
  Emit ""
  if ($code -eq 401) {
    Emit "  ! The app rejected this agent's token." -ForegroundColor Red
    Emit "    Delete jbg_agent_token.xml next to this script and run again to enter a new one." -ForegroundColor Red
  } else {
    Emit ("  ! Couldn't reach the app at {0}: {1}" -f $APP_URL, $_.Exception.Message) -ForegroundColor Red
  }
  Read-Host "  Press Enter to close"
  exit 1
}

Emit ""
Emit "  JBG Fiery Agent (HOT FOLDER) - polling every $POLL_SECONDS s." -ForegroundColor Green
Emit "  Dropping poster prints into: $HOTFOLDER" -ForegroundColor DarkGray
Emit "  FNSKU label jobs are skipped (those go to your label printer)." -ForegroundColor DarkGray
if ($FIERY_API_ENABLED -and $script:FierySession) { Emit "  Copies: AUTOMATIC via Fiery API - true page count kept, Copies field set on import, nothing to type at release." -ForegroundColor Green }
elseif ($COPIES_MODE -eq "repeat_pages") { Emit "  Copies: AUTOMATIC - pages are duplicated in the file (qpdf), nothing to set at release." -ForegroundColor Green }
elseif ($COPIES_MODE -eq "pjl") { Emit "  Copies: PJL mode - NOT recommended on this Fiery (known to corrupt jobs)." -ForegroundColor Red }
else { Emit "  Copies: set in the Fiery Copies field at release (the number is in the job title)." -ForegroundColor Cyan }
if (-not (Test-Path $HOTFOLDER)) { Emit "  ! hot folder not found yet - files will wait in _Fiery_Exports until it exists." -ForegroundColor Yellow }
Emit "  Keep the Fiery Hot Folders Console open too. Close this window to stop." -ForegroundColor DarkGray
Emit ""

while ($true) {
  try {
    # CLAIM the Fiery's own jobs (poster print files). FNSKU label jobs stay in
    # their own queue for the label printer and are not claimed here.
    #
    # Claiming, rather than the old read-and-hope: the previous version listed
    # everything still marked 'queued' and only marked a row 'done' after the
    # file had downloaded and copied. Anything slower than one poll interval was
    # therefore picked up AGAIN on the next tick and printed twice. The app now
    # hands each job to one agent and will not offer it to anyone else.
    $claimBody = @{ agent = $AGENT_NAME; limit = 25; type = "fiery" } | ConvertTo-Json -Compress
    $claimed = Invoke-RestMethod -Uri "$APP_URL/api/print-jobs/claim" -Headers $script:AppHeaders `
      -Method Post -ContentType "application/json" -Body $claimBody -TimeoutSec 30
    foreach ($j in $claimed.jobs) {
      # The app has already settled all of this: the size (from the catalog, not
      # guessed here), the copy count, and a finished download URL. The block
      # that used to rebuild cloud URLs from the SKU is gone with it - that was
      # this script's copy of a base URL the app also held.
      $size   = "$($j.size)"
      $copies = [int]$j.copies
      $url    = "$($j.fileUrl)"
      $sku    = "$($j.sku)"
      $type   = "$($j.type)"

      # download the file to a temp spot first
      $ext = [IO.Path]::GetExtension(($url -split '\?')[0]); if (-not $ext) { $ext = ".pdf" }
      $safe = ($sku -replace '[^A-Za-z0-9._-]', '_')
      $tmp  = Join-Path $TEMP ("dl_{0}{1}" -f $safe, $ext)
      try { Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 180 }
      catch {
        Complete-Job $j.id "error" "Print file could not be downloaded." | Out-Null
        Emit "  ! download failed for job $($j.id): $url" -ForegroundColor Red; continue
      }

      # Is it actually a print file? A URL that answers 200 with something else -
      # a login page at the end of a redirect, a proxy interstitial, an error
      # document - used to be copied into the hot folder under a .pdf name and
      # then fail at the Fiery, which is a slower and far more confusing way to
      # find out. Seen for real while testing this: an unauthenticated URL
      # redirected to a login page and 15 KB of HTML landed in the hot folder.
      $head = [byte[]]::new(5)
      $read = 0
      try {
        $fs = [IO.File]::OpenRead($tmp)
        try { $read = $fs.Read($head, 0, 5) } finally { $fs.Dispose() }
      } catch { $read = 0 }
      if ($read -lt 5 -or [Text.Encoding]::ASCII.GetString($head) -ne '%PDF-') {
        Complete-Job $j.id "error" "That link did not return a PDF." | Out-Null
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        Emit "  ! job $($j.id): not a PDF - $url" -ForegroundColor Red; continue
      }

      # copies: duplicate pages (default, but only for 1-2 page sources - see note above),
      # prepend a PJL header (not recommended here), or send untouched
      $srcPages = if ($COPIES_MODE -eq "repeat_pages" -and $copies -gt 1) { Get-PageCount $tmp } else { -1 }
      $tooManyPagesForRepeat = ($srcPages -lt 0 -or $srcPages -gt $REPEAT_PAGES_MAX_SRC_PAGES)
      $drop = switch ($COPIES_MODE) {
        "repeat_pages" { if ($tooManyPagesForRepeat) { $tmp } else { Add-RepeatedPages $tmp $copies $safe } }
        "pjl"          { Add-PjlCopies $tmp $copies $safe }
        default        { $tmp }
      }
      $builtCopies = ($drop -ne $tmp)

      # the file name becomes the Fiery job title - put the copy count + size in it, plus a short
      # unique token right after the SKU (survives title truncation better than a trailing suffix).
      # This makes the later Fiery job lookup unambiguous even if two jobs for the same SKU land
      # close together - matching on filename text alone can't tell those apart, a fresh token can.
      $fid  = [guid]::NewGuid().ToString("N").Substring(0, 8)
      $base = "{0}  FID{1}  x{2}  [{3}]" -f $safe, $fid, $copies, $size

      if (Test-Path $HOTFOLDER) {
        # drop it into the hot folder; the Fiery Hot Folders app imports it to the Held queue
        $dest = Join-Path $HOTFOLDER ($base + $ext)
        if (Test-Path $dest) { $n = "{0:000}" -f (Get-Random -Minimum 1 -Maximum 999); $dest = Join-Path $HOTFOLDER ($base + " " + $n + $ext) }
        try {
          Copy-Item -LiteralPath $drop -Destination $dest -Force
          Complete-Job $j.id "done" $null | Out-Null
          Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
          if ($builtCopies) { Remove-Item -LiteralPath $drop -Force -ErrorAction SilentlyContinue }

          # If the Fiery API is connected, look the job up once and set whatever applies:
          # Copies (jobs with copies > 1) and/or Media type/weight (every job, based on $size) -
          # instead of leaving either for manual entry/selection at release. True page count is
          # always preserved (COPIES_MODE stays "manual" - no page-duplication happens anywhere).
          $apiSetCopies = $false
          $apiSetMedia  = $false
          if ($FIERY_API_ENABLED -and $script:FierySession) {
            $heldJob = Find-FieryHeldJob $base $safe "FID$fid"
            if ($heldJob) {
              $jid = if ($heldJob.id) { $heldJob.id } elseif ($heldJob.jobID) { $heldJob.jobID } else { $null }
              if ($jid) {
                if ($copies -gt 1 -and (Set-FieryJobCopies $jid $copies)) { $apiSetCopies = $true }
                $mediaCfg = $FIERY_MEDIA_BY_SIZE[$size]
                if ($FIERY_SET_MEDIA -and $mediaCfg -and (Set-FieryJobMedia $jid $mediaCfg)) { $apiSetMedia = $true }
              }
            } else {
              Emit "  ! Fiery API: couldn't find held job matching '$base' - left for manual entry" -ForegroundColor Yellow
            }
          }

          $copiesNote = if ($apiSetCopies) { "x$copies set automatically via Fiery API" }
                  elseif ($builtCopies) { "x$copies pages built in - nothing to set at release" }
                  elseif ($copies -gt 1 -and $FIERY_API_ENABLED) { "x$copies in title (Fiery API couldn't set it this time - set Copies at release)" }
                  elseif ($copies -gt 1) { "x$copies in title (set at release - Fiery API is off)" }
                  else { "x1" }
          $mediaNote = if ($apiSetMedia) { "media set via API" }
                       elseif ($FIERY_SET_MEDIA -and $FIERY_API_ENABLED -and $FIERY_MEDIA_BY_SIZE[$size]) { "media NOT set - check Job Properties" }
                       else { $null }
          $note = if ($mediaNote) { "$copiesNote, $mediaNote" } else { $copiesNote }
          Emit ("  -> HELD  {0}  [{1}]  ({2})" -f $safe, $size, $note) -ForegroundColor Cyan
        } catch {
          # Hand it back so the next poll picks it up. Under the old read-only
          # poll this needed no action: the row was simply never marked done and
          # stayed 'queued'. A claimed row is not queued, so silence here would
          # park the job until the stale-claim sweep noticed it.
          Complete-Job $j.id "requeue" $null | Out-Null
          Emit ("  ! could not write to hot folder - will retry: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        }
      } else {
        # hot folder missing - keep the file so nothing is lost, hand the job back
        $dp = Join-Path $FALLBACK $size; New-Item -ItemType Directory -Force -Path $dp | Out-Null
        Copy-Item -LiteralPath $drop -Destination (Join-Path $dp ($base + $ext)) -Force
        if ($builtCopies) { Remove-Item -LiteralPath $drop -Force -ErrorAction SilentlyContinue }
        # Same as above: the file is safe in _Fiery_Exports, but the job has to
        # be given back explicitly now that it was claimed.
        Complete-Job $j.id "requeue" $null | Out-Null
        Emit ("  ! hot folder '{0}' not found - saved to {1}, will retry" -f $HOTFOLDER_NAME, $dp) -ForegroundColor Yellow
      }
    }
  } catch {
    # A rejected token is not a network hiccup and must not scroll past in grey:
    # every poll would fail the same way and the queue would fill up unnoticed.
    $code = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
    if ($code -eq 401) {
      Emit "  ! The app is rejecting this agent's token - nothing will print." -ForegroundColor Red
      Emit "    Delete jbg_agent_token.xml next to this script and restart to enter a new one." -ForegroundColor Red
    } else {
      Emit "  (waiting... $($_.Exception.Message))" -ForegroundColor DarkGray
    }
  }
  Start-Sleep -Seconds $POLL_SECONDS
}

# ============================================================
#  NOTES
#  - Copies (COPIES_MODE = "repeat_pages", the default): the exact count is
#    built into the file by duplicating its pages (via qpdf) - a 1-page
#    poster x4 becomes a 4-page file, a 2-page duplex map x3 becomes a
#    correctly-paired 6-page file (A,B,A,B,A,B). The Fiery prints one sheet
#    per page, so the job prints the right quantity with NOTHING to set at
#    release. The count is also in the job TITLE (e.g. "x10") for reference.
#  - If qpdf is ever missing, jobs still send fine but come in at 1 copy
#    (falls back to manual - set the count in the Fiery Copies field).
#  - The Fiery Hot Folders Console must be running and the "JBG Hold"
#    folder Active for imports to happen.
#  - Make sure the hot folder's Job action is "Hold" so jobs wait for
#    you (not "print", which would print immediately).
# ============================================================
