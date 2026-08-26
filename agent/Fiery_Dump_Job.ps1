# ============================================================
#  Fiery_Dump_Job.ps1  -  ONE-OFF DIAGNOSTIC, read-only
#
#  Prints every real attribute Fiery has for ONE job you give it the ID of.
#  Doesn't change anything on the job - just looks.
#
#  HOW TO USE THIS TO FIND THE REAL "MEDIA" FIELD NAME:
#   1. In Command WorkStation, open a Held job's Job Properties > Media tab
#      and set Media type / Media weight BY HAND, same as you always do. Click OK.
#   2. Right-click that job in Command WorkStation and check its Job ID
#      (or just use the job ID printed by JBG_Fiery_Agent.ps1's own log when
#      it held that job, e.g. "A00231468.6A8DF0C7.1178").
#   3. Right-click this file > Run with PowerShell.
#      Paste the Job ID when asked.
#   4. It prints every attribute Fiery actually has for that job. Look for
#      whatever key holds "Coated 3" / "Heavyweight 4" / "257-300 gsm" - THAT
#      is the real key name, whatever it's actually called. Paste me the
#      whole output and I'll wire the real name into the agent.
#
#  Uses the same saved login as JBG_Fiery_Agent.ps1 (fiery_credentials.xml next
#  to this script) - run the agent at least once first so that file exists.
# ============================================================

try {
  $ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
  $FIERY_HOST = "192.168.1.33"
  $FieryCredFile = Join-Path $ROOT "fiery_credentials.xml"

  if (-not (Test-Path -LiteralPath $FieryCredFile)) {
    Write-Host "No saved login found ($FieryCredFile). Run JBG_Fiery_Agent.ps1 once first so it saves one." -ForegroundColor Red
    return
  }

  Add-Type @"
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public static class FieryTrustAll2 {
  public static void Apply() {
    ServicePointManager.ServerCertificateValidationCallback =
      delegate(object s, X509Certificate c, X509Chain ch, SslPolicyErrors e) { return true; };
  }
}
"@
  [FieryTrustAll2]::Apply()
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

  $saved = Import-Clixml -LiteralPath $FieryCredFile
  $user  = $saved.User
  $pw    = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR(($saved.Pass | ConvertTo-SecureString)))
  $key   = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR(($saved.Key  | ConvertTo-SecureString)))
  $body  = @{ username = $user; password = $pw; accessrights = $key } | ConvertTo-Json
  $pw = $null; $key = $null

  try {
    $resp = Invoke-WebRequest -Uri "https://$FIERY_HOST/live/api/v3/login" -Method Post -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 15 -SessionVariable fierySess
  } catch {
    Write-Host "Login failed: $($_.Exception.Message)" -ForegroundColor Red
    return
  }
  Write-Host "Logged in as $user." -ForegroundColor Green

  $jobId = Read-Host "Paste the Job ID to dump (e.g. A00231468.6A8DF0C7.1178)"
  if ([string]::IsNullOrWhiteSpace($jobId)) { Write-Host "No Job ID given." -ForegroundColor Red; return }

  try {
    $full = Invoke-RestMethod -Uri "https://$FIERY_HOST/live/api/v3/jobs/$jobId" -WebSession $fierySess -Method Get -TimeoutSec 15
  } catch {
    Write-Host "Couldn't fetch job $jobId : $($_.Exception.Message)" -ForegroundColor Red
    return
  }

  Write-Host ""
  Write-Host "==== every attribute Fiery has for job $jobId ====" -ForegroundColor Cyan
  $full.PSObject.Properties | Sort-Object Name | ForEach-Object {
    Write-Host ("  {0,-30} = {1}" -f $_.Name, $_.Value)
  }
  Write-Host ""
  Write-Host "Look above for whatever line has 'Coated 3', 'Heavyweight 4', or '257-300 gsm' in it - paste that whole block back." -ForegroundColor Yellow
} catch {
  Write-Host ""
  Write-Host "! Unexpected error: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
} finally {
  Write-Host ""
  Read-Host "Press Enter to close this window"
}
