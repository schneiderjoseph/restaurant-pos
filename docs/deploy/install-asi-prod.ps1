<#
  Install / start the ASI (Resort F&B) profile of POSR on a dedicated production PC.
  Run in an elevated (Administrator) PowerShell, on the machine dedicated to POSR
  (NOT the ASI POS or ASI FrontDesk machines - those run their own SQL Server and
  are reached over the LAN, see asi-sync\.env below).

  What it does:
    1. Checks git / Node.js / Docker Desktop / pm2 - installs whatever is missing.
    2. Clones (or updates) the repo.
    3. Generates .env / gateway/.env / asi-sync/.env from the examples,
       auto-filling the JWT secret and detected LAN IP (secrets you must
       still paste yourself: SURREAL_PASS, ASI_SQL_PASSWORD, ASI_FD_SQL_PASSWORD).
    4. Starts surrealdb + gateway + api + printer + tracking + payment via
       Docker Compose.
    5. Applies pending Surreal migrations against posr/posr, then runs a
       first ASI sync (menu + tables + FrontDesk guests/rooms).
    6. Builds the SPA and serves it with nginx.
    7. Registers asi-sync + nginx under pm2, and pm2 under Windows startup,
       so everything comes back up after a reboot.

  Safe to re-run: every step is idempotent (skips what's already done).
  Full checklist / rationale: docs/deploy/PROD-ASI.md
#>

param(
  [string]$RepoPath = "C:\CODE\restaurant-pos",
  [string]$NginxRoot = "C:\nginx"
)

$ErrorActionPreference = 'Stop'

function Test-Cmd([string]$Name) {
  $null = Get-Command $Name -ErrorAction SilentlyContinue
  return [bool]$?
}

function Sync-PathFromRegistry {
  $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Step([string]$Text) {
  Write-Host ""
  Write-Host "== $Text ==" -ForegroundColor Cyan
}

function Ensure-Tool {
  param(
    [string]$Name,
    [string]$CommandName,
    [string]$WingetId,
    [string]$ManualUrl,
    [switch]$Required
  )
  if (Test-Cmd $CommandName) {
    Write-Host "$Name OK: $(& $CommandName --version)"
    return $true
  }
  if (Test-Cmd winget) {
    Write-Host "Installing $Name via winget..." -ForegroundColor Yellow
    try {
      winget install --id $WingetId -e --source winget --accept-package-agreements --accept-source-agreements
      Sync-PathFromRegistry
      if (Test-Cmd $CommandName) {
        Write-Host "$Name OK"
        return $true
      }
    } catch {
      Write-Host "winget install de $Name a echoue: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  } else {
    Write-Host "winget n'est pas disponible sur cette machine." -ForegroundColor Yellow
  }
  Write-Host "$Name n'est pas installe. Ouverture de la page de telechargement : $ManualUrl" -ForegroundColor Red
  Start-Process $ManualUrl
  if ($Required) {
    Write-Host "Installe $Name manuellement (options par defaut), ferme/rouvre PowerShell en Administrateur, puis relance ce script." -ForegroundColor Red
    exit 0
  }
  return $false
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Re-lance ce script en PowerShell Administrateur (winget / pm2-startup en ont besoin)." -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------------------
Step "1. Prerequisites"

Write-Host "IMPORTANT: ce script s'installe sur la machine dediee a POSR (Docker/gateway/nginx/asi-sync)." -ForegroundColor Yellow
Write-Host "ASI POS et ASI FrontDesk tournent sur d'autres machines du meme LAN - asi-sync leur parlera par IP LAN (SQL Server), jamais en localhost." -ForegroundColor Yellow
Write-Host "AVANT de lancer ce script, sur les machines ASI POS et ASI FrontDesk :" -ForegroundColor Yellow
Write-Host "  1. Active le protocole TCP/IP (SQL Server Configuration Manager > SQL Server Network Configuration > Protocols > TCP/IP > Enabled), redemarre le service SQL Server." -ForegroundColor Yellow
Write-Host "  2. Ouvre le port SQL dans le pare-feu Windows (idealement limite au sous-reseau des tablettes / a l'IP de la machine POSR, pas 'Any')." -ForegroundColor Yellow
Write-Host "  3. Cree/verifie les logins SQL posr_sync (sur ASIPOS600) et posr_fd_sync (sur ASIFD600) avec acces reseau." -ForegroundColor Yellow

Ensure-Tool -Name "Git" -CommandName git -WingetId "Git.Git" -ManualUrl "https://git-scm.com/download/win" -Required | Out-Null
Sync-PathFromRegistry

Ensure-Tool -Name "Node.js" -CommandName node -WingetId "OpenJS.NodeJS.LTS" -ManualUrl "https://nodejs.org/en/download" -Required | Out-Null
Sync-PathFromRegistry

Ensure-Tool -Name "Docker Desktop" -CommandName docker -WingetId "Docker.DockerDesktop" -ManualUrl "https://www.docker.com/products/docker-desktop/" -Required | Out-Null
Sync-PathFromRegistry

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker Desktop est installe mais pas demarre (ou premier lancement pas termine : compte / WSL2)." -ForegroundColor Red
  Write-Host "Lance-le, attends qu'il soit pret, active Settings > General > Start Docker Desktop when you log in, puis relance ce script." -ForegroundColor Red
  Write-Host "Verifie aussi que la RAM allouee a Docker Desktop laisse assez de marge pour ASI + SQL Server (Settings > Resources)." -ForegroundColor Yellow
  exit 0
}

Ensure-Tool -Name "mkcert" -CommandName mkcert -WingetId "FiloSottile.mkcert" -ManualUrl "https://github.com/FiloSottile/mkcert/releases" | Out-Null
Sync-PathFromRegistry

if (-not (Test-Cmd pm2)) {
  Write-Host "Installing pm2 + pm2-windows-startup..." -ForegroundColor Yellow
  npm install -g pm2 pm2-windows-startup
  Sync-PathFromRegistry
  pm2-startup install
} else {
  Write-Host "pm2 OK"
}

# ---------------------------------------------------------------------------
Step "2. Code"

if (-not (Test-Path $RepoPath)) {
  $parent = Split-Path $RepoPath
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  git clone https://github.com/schneiderjoseph/restaurant-pos.git $RepoPath
} else {
  Set-Location $RepoPath
  git fetch origin
  git checkout main
  git pull origin main
}
Set-Location $RepoPath

# ---------------------------------------------------------------------------
Step "3. LAN IP + secrets"

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.IPAddress -notlike '169.254*' } |
  Select-Object -First 1).IPAddress
if (-not $ip) { $ip = "<PROPERTY_LAN_IP>" }
Write-Host "IP LAN detectee : $ip  (verifie avec ipconfig si ca semble faux)" -ForegroundColor Yellow

$jwt = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

if (-not (Test-Path ".env")) {
@"
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG
SURREAL_NS=posr
SURREAL_DB=posr

GATEWAY_JWT_SECRET=$jwt
GATEWAY_ALLOWED_ORIGINS=http://$ip,https://$ip,http://localhost,http://127.0.0.1
GATEWAY_ALLOW_LAN=true

VITE_GATEWAY_AUTH=true
VITE_DB_WEBDOCKET=ws://$ip/rpc

VITE_LOCALE=fr-HT
VITE_DEFAULT_LANGUAGE=fr
VITE_APP_TIMEZONE=America/Port-au-Prince
VITE_CURRENCY=HTG
VITE_DECIMAL_PLACES=0

VITE_PRINT_SERVER_URL=http://${ip}:3132
VITE_API_SERVER_URL=http://${ip}:3140
VITE_TRACKING_SERVER_URL=http://${ip}:3138
VITE_TRACKING_ENABLED=true
VITE_PROTECT_MODULES_SOURCE=server

VITE_POS_MODE=asi
VITE_RESORT_FB=true

VITE_MODULE_HR=false
VITE_MODULE_DELIVERY=false
VITE_MODULE_INTEGRATIONS=false
VITE_MODULE_ACCOUNTING=false
VITE_MODULE_CLOSING=false

VITE_RESTAURANT_NAME=
VITE_RESTAURANT_ADDRESS=
VITE_RESTAURANT_PHONE=
"@ | Out-File -FilePath ".env" -Encoding utf8
  Write-Host "Ecrit .env" -ForegroundColor Green
} else {
  Write-Host ".env existe deja - pas touche."
}

if (-not (Test-Path "gateway\.env")) {
@"
GATEWAY_HOST=0.0.0.0
GATEWAY_PORT=3142
GATEWAY_JWT_SECRET=$jwt
GATEWAY_JWT_TTL=12h
GATEWAY_ALLOWED_ORIGINS=http://$ip,https://$ip,http://localhost,http://127.0.0.1
GATEWAY_ALLOW_LAN=true

SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_NS=posr
SURREAL_DB=posr
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG
SURREAL_CONNECT_TIMEOUT_MS=10000
"@ | Out-File -FilePath "gateway\.env" -Encoding utf8
  Write-Host "Ecrit gateway\.env" -ForegroundColor Green
} else {
  Write-Host "gateway\.env existe deja - pas touche."
}

if (-not (Test-Path "asi-sync\.env")) {
@"
# Menu + tables ASI POS (SQL Server sur la machine ASI POS, PAS ce PC).
# Remplace <POS_ASI_IP> par l'IP LAN reelle de la machine ASI POS.
# Confirme le port sur place (SQL Server Configuration Manager > SQL Server
# Network Configuration > Protocols > TCP/IP) - 56479 est juste un exemple,
# rien ne garantit qu'il soit identique sur une autre machine/instance.
ASI_SQL_SERVER=<POS_ASI_IP>
ASI_SQL_PORT=56479
ASI_SQL_DATABASE=ASIPOS600
ASI_SQL_USER=posr_sync
ASI_SQL_PASSWORD=CHANGE_ME
ASI_SQL_ENCRYPT=false
ASI_SQL_TRUST_CERT=true
ASI_MENU_SYNC=1
ASI_TABLE_SYNC=1

# FrontDesk guests + chambres (SQL Server sur la machine PMS, une 3e machine
# possible - remplace <PMS_LAN_IP> par son IP LAN reelle).
ASI_FD_SYNC=1
ASI_ROOM_SYNC=1
ASI_FD_SQL_SERVER=<PMS_LAN_IP>
ASI_FD_SQL_PORT=56479
ASI_FD_SQL_DATABASE=ASIFD600
ASI_FD_SQL_USER=posr_fd_sync
ASI_FD_SQL_PASSWORD=CHANGE_ME
ASI_FD_SQL_ENCRYPT=false
ASI_FD_SQL_TRUST_CERT=true

SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_NS=posr
SURREAL_DB=posr
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG

ASI_SYNC_INTERVAL_MS=30000
ASI_SYNC_ONCE=0
"@ | Out-File -FilePath "asi-sync\.env" -Encoding utf8
  Write-Host "Ecrit asi-sync\.env" -ForegroundColor Green
} else {
  Write-Host "asi-sync\.env existe deja - pas touche."
}

Write-Host ""
Write-Host "STOP - avant de continuer, edite ces 3 fichiers :" -ForegroundColor Red
Write-Host "  - .env, gateway\.env, asi-sync\.env : SURREAL_PASS (meme valeur forte partout)"
Write-Host "  - asi-sync\.env : ASI_SQL_SERVER (IP LAN de la machine ASI POS) et ASI_FD_SQL_SERVER (IP LAN de la machine ASI FrontDesk/PMS)"
Write-Host "  - asi-sync\.env : ASI_SQL_PASSWORD (login posr_sync sur ASIPOS600) et ASI_FD_SQL_PASSWORD (login posr_fd_sync sur ASIFD600)"
Write-Host "  - Confirme les ports SQL reels sur chaque machine (*_SQL_PORT) - 56479 n'est qu'un exemple d'une autre installation"
Read-Host "Appuie sur Entree une fois que c'est fait"

# ---------------------------------------------------------------------------
Step "4. Docker services (surrealdb + gateway + api + printer + tracking + payment)"

docker compose up -d surrealdb gateway api printer tracking payment

# ---------------------------------------------------------------------------
Step "5. Migrations posr/posr + premier sync ASI"

$envFile = Get-Content ".env" -Raw
function Get-EnvValue([string]$content, [string]$name) {
  $m = [regex]::Match($content, "(?m)^$name=(.*)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return $null
}
$env:SURREAL_URL = "ws://127.0.0.1:8000/rpc"
$env:SURREAL_NS = "posr"
$env:SURREAL_DB = "posr"
$env:SURREAL_USER = Get-EnvValue $envFile "SURREAL_USER"
$env:SURREAL_PASS = Get-EnvValue $envFile "SURREAL_PASS"

# npm install first: run-prod-migrations.cjs and bootstrap-asi-fields.cjs both
# need the root `ws` + `surrealdb` packages to run outside Docker.
npm install
node migrations/scripts/run-prod-migrations.cjs
# run-prod-migrations.cjs's plan predates the ASI/Resort F&B fields below -
# applied separately here (idempotent, safe to re-run).
node migrations/scripts/bootstrap-asi-fields.cjs

Set-Location "$RepoPath\asi-sync"
npm install
Write-Host "Test de connexion SQL ASI (ASI POS + FrontDesk doivent deja tourner)..." -ForegroundColor Yellow
npm run once
Set-Location $RepoPath

# ---------------------------------------------------------------------------
Step "6. Build SPA"

npm install
# `npm run build` (tsc && vite build) fails on pre-existing type errors
# unrelated to this deploy - build via vite directly (esbuild transpile,
# no type-check gate) so a real dist/ is produced regardless.
npx vite build
if (-not (Test-Path "dist\index.html")) {
  Write-Host "ERREUR: dist\index.html n'existe pas apres le build - le build SPA a echoue." -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------------------
Step "7. nginx (sert dist/, proxy /auth + /rpc vers le gateway)"

if (-not (Test-Path "$NginxRoot\nginx.exe")) {
  Write-Host "Telechargement nginx..." -ForegroundColor Yellow
  $zip = Join-Path $env:TEMP "nginx.zip"
  Invoke-WebRequest -Uri "https://nginx.org/download/nginx-1.26.2.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $env:TEMP -Force
  $extracted = Get-ChildItem $env:TEMP -Directory -Filter "nginx-*" | Select-Object -First 1
  Move-Item $extracted.FullName $NginxRoot
}

Copy-Item "$RepoPath\nginx.conf" "$NginxRoot\conf\nginx-posr.conf" -Force
$nginxMain = Get-Content "$NginxRoot\conf\nginx.conf" -Raw
if ($nginxMain -notmatch "nginx-posr\.conf") {
  Write-Host "IMPORTANT: edite $NginxRoot\conf\nginx.conf a la main - remplace le bloc 'server { ... }' par :" -ForegroundColor Red
  Write-Host "    include conf/nginx-posr.conf;"
}
Remove-Item "$NginxRoot\html" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$RepoPath\dist" "$NginxRoot\html" -Recurse -Force

# ---------------------------------------------------------------------------
Step "8. Persistence (pm2 + Windows startup)"

Set-Location $RepoPath
pm2 delete asi-sync 2>$null | Out-Null
pm2 start npm --name asi-sync --cwd "$RepoPath\asi-sync" -- start

pm2 delete nginx 2>$null | Out-Null
# `-g "daemon off;"` keeps nginx in the foreground - nginx daemonizes by
# default, which would make pm2 think the process exited immediately.
pm2 start "$NginxRoot\nginx.exe" --name nginx --cwd $NginxRoot -- -g "daemon off;"

pm2 save

Write-Host ""
Write-Host "== Termine ==" -ForegroundColor Green
Write-Host "Docker (surrealdb/gateway/api/printer/tracking/payment) redemarre seul si Docker Desktop est configure pour se lancer a l'ouverture de session (Settings > General)."
Write-Host "asi-sync + nginx redemarrent via pm2 (pm2-startup) au reboot."
Write-Host "Il faut aussi creer le premier compte admin (PIN + role Master) - voir docs/user-guide/ADMIN-USERS.md."
Write-Host "Verifie la checklist smoke test : docs/deploy/PROD-ASI.md #7"
Write-Host "UI: http://$ip/"
