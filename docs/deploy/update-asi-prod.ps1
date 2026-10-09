<#
  Update an existing ASI (Resort F&B) production install of POSR to the latest
  code. Run in an elevated (Administrator) PowerShell on the POSR machine.
  First install: install-asi-prod.ps1 - this script only upgrades.

  What it does:
    1. Checks the tools, the repo and that the working tree has no local edits.
    2. Backs up the Surreal database (surreal export -> backups\surrealdb\).
    3. Pulls the new code (fast-forward only) and lists what changes.
    4. Re-installs npm packages where package.json / package-lock.json changed.
    5. Applies the upgrade migrations (idempotent, see $UpgradeMigrations).
    6. Restarts / rebuilds only the Docker services whose code changed.
    7. Builds the SPA and swaps it into nginx (previous build kept as html.prev).
    8. Restarts asi-sync under pm2.

  Safe to re-run. Nothing new to pull -> stops after step 3 unless -Force.
  Rollback: printed at the end (previous commit + html.prev + backup file).
#>

param(
  # Default: the repo this script lives in (docs\deploy\ -> repo root).
  [string]$RepoPath = "",
  [string]$NginxRoot = "C:\nginx",
  [string]$Remote = "origin",
  [string]$Branch = "main",
  # Rebuild + restart even when there is nothing new to pull.
  [switch]$Force,
  # Skip the pre-update database export (not recommended).
  [switch]$SkipBackup
)

$ErrorActionPreference = 'Stop'

if (-not $RepoPath) {
  $RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

# Migrations applied on every update. Each file MUST be idempotent
# (DEFINE ... IF NOT EXISTS / OVERWRITE). Append new ones when a release
# changes the schema. Not run-prod-migrations.cjs: an install made by
# bootstrap-posr-db.cjs has no _schema_migration history, so that runner
# would replay pre-snapshot migrations.
$UpgradeMigrations = @(
  '2026_10_01_customer_notes.surql'
  '2026_10_02_session_security_default.surql'
  '2026_10_02_general_settings_access.surql'
  '2026_10_02_user_unique_pin.surql'
  '2026_10_02_pin_only_login.surql'
  '2026_10_02_customer_id_document.surql'
  '2026_10_02_customer_asi_date_out.surql'
  '2026_10_02_outlets.surql'
  '2026_10_02_order_visibility.surql'
  '2026_10_03_user_session.surql'
  '2026_10_03_order_due_at.surql'
  '2026_10_03_role_payment_access.surql'
  '2026_10_03_order_edit_request.surql'
  '2026_10_05_order_served_at.surql'
  '2026_10_05_order_excluded_taxes.surql'
  '2026_10_05_free_discounts.surql'
  '2026_10_05_station_accounts.surql'
  '2026_10_05_order_edit_split_roles.surql'
  '2026_10_07_order_item_split_source.surql'
  '2026_10_07_duo.surql'
  '2026_10_07_included_modifiers.surql'
  '2026_10_07_drop_inventory_hr_tables.surql'
  '2026_10_08_customers_view_phone.surql'
  '2026_10_08_anonymous_cash_customer.surql'
  '2026_10_08_manual_stay.surql'
  '2026_10_08_manual_stay_fix.surql'
  '2026_10_09_sales_by_customer_report.surql'
)

# Docker services the ASI profile runs, and the folder each one mounts.
# printer is built from a Dockerfile; the others run `npm install && node`
# on start, so a restart picks up new code.
$ServiceDirs = [ordered]@{
  gateway  = 'gateway'
  api      = 'api'
  printer  = 'printing'
  tracking = 'tracking-api'
  payment  = 'payments'
}
$AllServices = @('surrealdb') + @($ServiceDirs.Keys)

function Test-Cmd([string]$Name) {
  $null = Get-Command $Name -ErrorAction SilentlyContinue
  return [bool]$?
}

function Step([string]$Text) {
  Write-Host ""
  Write-Host "== $Text ==" -ForegroundColor Cyan
}

function Fail([string]$Text) {
  Write-Host ""
  Write-Host "ERREUR: $Text" -ForegroundColor Red
  if ($script:OldHead) {
    Write-Host "Code avant la mise a jour : $script:OldHead" -ForegroundColor Yellow
  }
  if ($script:BackupFile) {
    Write-Host "Sauvegarde de la base : $script:BackupFile" -ForegroundColor Yellow
  }
  exit 1
}

# Native commands don't throw in Windows PowerShell - check the exit code.
function Invoke-Native([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) {
    Fail "$What a echoue (code $LASTEXITCODE)."
  }
}

function Get-EnvValue([string]$Content, [string]$Name) {
  $m = [regex]::Match($Content, "(?m)^$Name=(.*)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return $null
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Re-lance ce script en PowerShell Administrateur (nginx dans $NginxRoot, pm2)." -ForegroundColor Red
  exit 1
}

# npm/npx/pm2 are .ps1 shims - blocked by the default RemoteSigned policy.
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# ---------------------------------------------------------------------------
Step "1. Verifications"

foreach ($tool in @('git', 'node', 'npm', 'npx', 'docker', 'pm2')) {
  if (-not (Test-Cmd $tool)) {
    Fail "'$tool' introuvable. La machine a-t-elle ete installee avec install-asi-prod.ps1 ?"
  }
}
if (-not (Test-Path "$RepoPath\.git")) {
  Fail "Pas de repo git dans $RepoPath (parametre -RepoPath)."
}
if (-not (Test-Path "$NginxRoot\nginx.exe")) {
  Fail "nginx introuvable dans $NginxRoot (parametre -NginxRoot)."
}
Set-Location $RepoPath

if (-not (Test-Path ".env")) {
  Fail "$RepoPath\.env manquant."
}
$envFile = Get-Content ".env" -Raw
$env:SURREAL_URL = "ws://127.0.0.1:8000/rpc"
$env:SURREAL_NS = "posr"
$env:SURREAL_DB = "posr"
$env:SURREAL_USER = Get-EnvValue $envFile "SURREAL_USER"
$env:SURREAL_PASS = Get-EnvValue $envFile "SURREAL_PASS"
if (-not $env:SURREAL_USER -or -not $env:SURREAL_PASS) {
  Fail "SURREAL_USER / SURREAL_PASS absents de .env."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "Docker Desktop n'est pas demarre. Lance-le, attends qu'il soit pret, puis relance."
}
if (-not (Test-NetConnection 127.0.0.1 -Port 8000 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
  Fail "SurrealDB ne repond pas sur 127.0.0.1:8000 (docker compose up -d surrealdb ?)."
}

# database/ is the live Surreal data dir (database/LOCK is tracked): ignore it.
# package-lock.json files are rewritten by every `npm install`, including the
# ones the payment/gateway/api containers run in their bind-mounted folders:
# that drift is expected and gets reset before the pull (step 4).
$status = @(git status --porcelain --untracked-files=no -- . ':!database')
$lockDrift = @($status | Where-Object { $_ -match '^ M (.+/)?package-lock\.json$' } | ForEach-Object { $_.Substring(3) })
$dirty = @($status | Where-Object { $_ -notmatch '^ M (.+/)?package-lock\.json$' })
if ($lockDrift.Count) {
  Write-Host "package-lock.json regeneres par npm (remis a l'etat du repo avant le pull) : $($lockDrift -join ', ')"
}
if ($dirty.Count) {
  Write-Host $($dirty -join "`n")
  Fail "Modifications locales dans le repo. Sauvegarde-les ou annule-les (git stash) avant de mettre a jour."
}

$script:OldHead = (git rev-parse HEAD).Trim()
$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($currentBranch -ne $Branch) {
  Fail "Le repo est sur la branche '$currentBranch', attendu '$Branch'."
}
Write-Host "Repo OK : $RepoPath ($Branch @ $($script:OldHead.Substring(0, 8)))"

# ---------------------------------------------------------------------------
Step "2. Nouveautes"

Invoke-Native "git fetch" { git fetch $Remote $Branch }
$incoming = git log --oneline "HEAD..$Remote/$Branch"
if (-not $incoming) {
  Write-Host "Deja a jour ($($script:OldHead.Substring(0, 8)))." -ForegroundColor Green
  if (-not $Force) {
    Write-Host "Rien a faire. (-Force pour rebuild + redemarrer quand meme.)"
    exit 0
  }
} else {
  Write-Host "Nouveaux commits :"
  $incoming | ForEach-Object { Write-Host "  $_" }
}

# ---------------------------------------------------------------------------
Step "3. Sauvegarde de la base"

if ($SkipBackup) {
  Write-Host "Sauvegarde sautee (-SkipBackup)." -ForegroundColor Yellow
} else {
  $backupDir = Join-Path $RepoPath "backups\surrealdb"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $script:BackupFile = Join-Path $backupDir "pre-update-$stamp.surql"
  $errFile = Join-Path $env:TEMP "posr-backup-$stamp.err"
  # Start-Process keeps the export's bytes as-is (a PowerShell `>` would
  # re-encode it to UTF-16). Same export command as the compose backup service.
  $exportArgs = @(
    'compose', 'exec', '-T', 'surrealdb', '/surreal', '--log', 'none', 'export',
    '--endpoint', 'http://127.0.0.1:8000',
    '--username', "`"$env:SURREAL_USER`"", '--password', "`"$env:SURREAL_PASS`"",
    '--namespace', 'posr', '--database', 'posr', '-'
  )
  $proc = Start-Process -FilePath docker -ArgumentList $exportArgs -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $script:BackupFile -RedirectStandardError $errFile
  $size = if (Test-Path $script:BackupFile) { (Get-Item $script:BackupFile).Length } else { 0 }
  if ($proc.ExitCode -ne 0 -or $size -lt 1024) {
    if (Test-Path $errFile) { Get-Content $errFile | Write-Host }
    Remove-Item $script:BackupFile -ErrorAction SilentlyContinue
    $script:BackupFile = $null
    Fail "La sauvegarde de la base a echoue - mise a jour annulee, rien n'a change. (-SkipBackup pour forcer, deconseille)"
  }
  Remove-Item $errFile -ErrorAction SilentlyContinue
  Write-Host ("Sauvegarde OK : {0} ({1:N1} Mo)" -f $script:BackupFile, ($size / 1MB)) -ForegroundColor Green
}

# ---------------------------------------------------------------------------
Step "4. Code"

if ($lockDrift.Count) {
  Invoke-Native "reset package-lock.json" { git checkout -- @lockDrift }
}
if ($incoming) {
  Invoke-Native "git pull" { git pull --ff-only $Remote $Branch }
}
$newHead = (git rev-parse HEAD).Trim()
$changed = @()
if ($newHead -ne $script:OldHead) {
  $changed = @(git diff --name-only $script:OldHead $newHead)
}
Write-Host "Code : $($newHead.Substring(0, 8)) ($($changed.Count) fichiers modifies)"

function Test-Changed([string]$Prefix) {
  return [bool]($changed | Where-Object { $_ -like "$Prefix*" })
}

# ---------------------------------------------------------------------------
Step "5. Dependances npm"

# A running dev-live Vite keeps native modules (rolldown .node) open: npm then
# fails to remove the old copies (EPERM). Stop it here, restart it after the build.
$devLiveScript = Join-Path $RepoPath "scripts\dev-live.ps1"
$viteConn = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -First 1
$script:RestartDevLive = [bool]$viteConn
if ($viteConn) {
  Write-Host "Vite (dev-live) arrete pendant l'installation, nginx sert le build statique."
  Stop-Process -Id $viteConn.OwningProcess -Force
}

$rootDeps = (Test-Changed 'package.json') -or (Test-Changed 'package-lock.json') -or -not (Test-Path 'node_modules')
if ($rootDeps -or $Force) {
  Invoke-Native "npm install (racine)" { npm install }
} else {
  Write-Host "Racine : inchange."
}
$syncDeps = (Test-Changed 'asi-sync/package') -or -not (Test-Path 'asi-sync\node_modules')
if ($syncDeps -or $Force) {
  Invoke-Native "npm install (asi-sync)" { npm --prefix asi-sync install }
} else {
  Write-Host "asi-sync : inchange."
}

# ---------------------------------------------------------------------------
Step "6. Migrations"

foreach ($file in $UpgradeMigrations) {
  Invoke-Native "migration $file" { node migrations/scripts/apply-migration.cjs "migrations/$file" }
}
# order.order_type is required; no-op when order types already exist.
Invoke-Native "types de commande" { node migrations/scripts/bootstrap-order-types.cjs }

# ---------------------------------------------------------------------------
Step "7. Services Docker"

if ($Force -or (Test-Changed 'docker-compose.yml')) {
  # Recreates only the containers whose compose config changed.
  Invoke-Native "docker compose up" { docker compose up -d @AllServices }
}
foreach ($svc in $ServiceDirs.Keys) {
  $dir = $ServiceDirs[$svc]
  if ($svc -eq 'printer' -and ((Test-Changed 'printing/Dockerfile') -or (Test-Changed 'printing/package'))) {
    Invoke-Native "rebuild printer" { docker compose up -d --build printer }
  } elseif ($Force -or (Test-Changed "$dir/")) {
    Invoke-Native "restart $svc" { docker compose restart $svc }
  } else {
    Write-Host "${svc} : inchange."
  }
}

# ---------------------------------------------------------------------------
Step "8. Interface (SPA)"

# `npm run build` runs tsc first and fails on pre-existing type errors;
# vite alone produces the same bundle (same choice as install-asi-prod.ps1).
Remove-Item dist -Recurse -Force -ErrorAction SilentlyContinue
Invoke-Native "build SPA" { npx vite build }
if (-not (Test-Path "dist\index.html")) {
  Fail "dist\index.html absent apres le build. L'ancienne interface est toujours en ligne."
}

# Swap: html.new -> html, previous build kept as html.prev for rollback.
$html = Join-Path $NginxRoot "html"
$htmlNew = Join-Path $NginxRoot "html.new"
$htmlPrev = Join-Path $NginxRoot "html.prev"
Remove-Item $htmlNew -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$RepoPath\dist" $htmlNew -Recurse -Force
Remove-Item $htmlPrev -Recurse -Force -ErrorAction SilentlyContinue
try {
  if (Test-Path $html) {
    Rename-Item $html "html.prev"
  }
  Rename-Item $htmlNew "html"
} catch {
  # Put the previous build back so the site never stays down.
  if (-not (Test-Path $html) -and (Test-Path $htmlPrev)) {
    Rename-Item $htmlPrev "html"
  }
  Fail "Bascule de l'interface impossible ($($_.Exception.Message)). L'ancienne interface est toujours en ligne."
}
Write-Host "Interface en ligne (ancienne version : $htmlPrev)." -ForegroundColor Green

if ($script:RestartDevLive) {
  & $devLiveScript on
}

# ---------------------------------------------------------------------------
Step "9. asi-sync"

# pm2 writes to stderr on Windows; keep it non-fatal and check the result.
$ErrorActionPreference = 'Continue'
pm2 restart asi-sync --update-env
$pm2Exit = $LASTEXITCODE
pm2 save | Out-Null
$ErrorActionPreference = 'Stop'
if ($pm2Exit -ne 0) {
  Fail "pm2 restart asi-sync a echoue. Verifie 'pm2 list' (le reste de la mise a jour est fait)."
}

# ---------------------------------------------------------------------------
Step "Termine"

Write-Host "Code : $($script:OldHead.Substring(0, 8)) -> $($newHead.Substring(0, 8))" -ForegroundColor Green
Write-Host "Rafraichis la page sur chaque tablette pour charger la nouvelle interface."
Write-Host "Logs de la synchro : pm2 logs asi-sync --lines 30"
Write-Host ""
Write-Host "Retour arriere si besoin :" -ForegroundColor Yellow
Write-Host "  git -C `"$RepoPath`" reset --hard $($script:OldHead)"
Write-Host "  Remove-Item `"$html`" -Recurse -Force; Rename-Item `"$htmlPrev`" html"
Write-Host "  pm2 restart asi-sync"
if ($script:BackupFile) {
  Write-Host "  Base (seulement si une migration pose probleme) : $($script:BackupFile)"
}
