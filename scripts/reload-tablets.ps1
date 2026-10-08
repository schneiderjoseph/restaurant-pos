<#
  Bump C:\nginx\html\version.json so tablets running the client-update poller
  reload at the next quiet moment (PIN screen, hidden tab, or ~60s idle).

  Does NOT rebuild the SPA — use after a deploy if tablets are stuck, or alone
  to force a refresh of the same bundle.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\reload-tablets.ps1
#>
param(
  [string]$NginxHtml = "C:\nginx\html"
)

$ErrorActionPreference = 'Stop'

$versionPath = Join-Path $NginxHtml 'version.json'
if (-not (Test-Path $NginxHtml)) {
  throw "nginx html introuvable: $NginxHtml"
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$sha = $null
try {
  $sha = (git -C (Split-Path -Parent $PSScriptRoot) rev-parse --short HEAD 2>$null).Trim()
} catch {}

$buildId = if ($sha) { "$stamp-$sha" } else { "$stamp" }
$payload = @{ buildId = $buildId } | ConvertTo-Json -Compress
# nginx / Chrome: UTF-8 without BOM
[IO.File]::WriteAllText($versionPath, $payload + "`n", (New-Object Text.UTF8Encoding $false))

Write-Host "version.json -> $buildId" -ForegroundColor Green
Write-Host "Les tablettes avec le poller rechargent au prochain moment calme (~15s + idle/PIN)."
