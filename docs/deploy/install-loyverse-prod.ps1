<#
  Install / start the Loyverse profile of POSR on a dedicated production PC.
  Run in an elevated (Administrator) PowerShell.

  What it does:
    1. Checks git / Node.js / Docker Desktop / pm2 - installs whatever is missing.
    2. Clones (or updates) the repo.
    3. Generates .env / gateway/.env / loyverse-sync/.env from the examples,
       auto-filling the JWT secret and detected LAN IP (secrets you must
       still paste yourself: SURREAL_PASS, LOYVERSE_ACCESS_TOKEN).
    4. Starts surrealdb + gateway + printer via Docker Compose.
    5. Bootstraps the isolated `loyverse`/`loyverse` Surreal DB and runs a
       first catalogue sync.
    6. Builds the SPA and serves it with nginx.
    7. Registers loyverse-sync + nginx under pm2, and pm2 under Windows
       startup, so everything comes back up after a reboot.

  Safe to re-run: every step is idempotent (skips what's already done).
  Full checklist / rationale: docs/deploy/PROD-LOYVERSE.md
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

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Re-lance ce script en PowerShell Administrateur (winget / pm2-startup en ont besoin)." -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------------------
Step "1. Prerequisites"

if (-not (Test-Cmd git)) {
  Write-Host "Installing Git..." -ForegroundColor Yellow
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
} else {
  Write-Host "Git OK: $(git --version)"
}

if (-not (Test-Cmd node)) {
  Write-Host "Installing Node.js LTS..." -ForegroundColor Yellow
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
} else {
  Write-Host "Node OK: $(node --version)"
}

Sync-PathFromRegistry

if (-not (Test-Cmd docker)) {
  Write-Host "Installing Docker Desktop..." -ForegroundColor Yellow
  winget install --id Docker.DockerDesktop -e --source winget --accept-package-agreements --accept-source-agreements
  Write-Host "Docker Desktop vient d'etre installe : ouvre-le une fois manuellement (compte / WSL2), active 'Start Docker Desktop when you log in' dans Settings > General, puis relance ce script." -ForegroundColor Red
  exit 0
} else {
  Write-Host "Docker OK: $(docker --version)"
}

try {
  docker info *> $null
} catch {
  Write-Host "Docker Desktop est installe mais pas demarre. Lance-le, attends qu'il soit pret, puis relance ce script." -ForegroundColor Red
  exit 0
}

if (-not (Test-Cmd mkcert)) {
  Write-Host "Installing mkcert (optional, HTTPS LAN pour l'impression)..." -ForegroundColor Yellow
  try {
    winget install --id FiloSottile.mkcert -e --source winget --accept-package-agreements --accept-source-agreements
  } catch {
    Write-Host "mkcert install a echoue - pas bloquant, voir printing/README.md pour l'installer a la main." -ForegroundColor Yellow
  }
} else {
  Write-Host "mkcert OK"
}

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
SURREAL_NS=loyverse
SURREAL_DB=loyverse

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
VITE_PROTECT_MODULES_SOURCE=server

VITE_POS_MODE=loyverse
VITE_RESORT_FB=false

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
SURREAL_NS=loyverse
SURREAL_DB=loyverse
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG
SURREAL_CONNECT_TIMEOUT_MS=10000
"@ | Out-File -FilePath "gateway\.env" -Encoding utf8
  Write-Host "Ecrit gateway\.env" -ForegroundColor Green
} else {
  Write-Host "gateway\.env existe deja - pas touche."
}

if (-not (Test-Path "loyverse-sync\.env")) {
@"
LOYVERSE_ACCESS_TOKEN=PASTE_PAT_FROM_BACK_OFFICE
LOYVERSE_STORE_ID=
LOYVERSE_MENU_SYNC=1
LOYVERSE_CUSTOMER_SYNC=1
LOYVERSE_PAYMENT_SYNC=1
LOYVERSE_DISCOUNT_SYNC=1
LOYVERSE_MODIFIER_SYNC=1

SURREAL_URL=ws://127.0.0.1:8000/rpc
LOYVERSE_SURREAL_NS=loyverse
LOYVERSE_SURREAL_DB=loyverse
SURREAL_USER=posr_prod_user
SURREAL_PASS=CHANGE_ME_STRONG

LOYVERSE_SYNC_INTERVAL_MS=60000
LOYVERSE_SYNC_ONCE=0
"@ | Out-File -FilePath "loyverse-sync\.env" -Encoding utf8
  Write-Host "Ecrit loyverse-sync\.env" -ForegroundColor Green
} else {
  Write-Host "loyverse-sync\.env existe deja - pas touche."
}

Write-Host ""
Write-Host "STOP - avant de continuer, edite ces 3 fichiers :" -ForegroundColor Red
Write-Host "  - .env, gateway\.env, loyverse-sync\.env : SURREAL_PASS (meme valeur forte partout)"
Write-Host "  - loyverse-sync\.env : LOYVERSE_ACCESS_TOKEN (Back Office Loyverse -> Access Tokens)"
Read-Host "Appuie sur Entree une fois que c'est fait"

# ---------------------------------------------------------------------------
Step "4. Docker services (surrealdb + gateway + printer)"

docker compose up -d surrealdb gateway printer

# ---------------------------------------------------------------------------
Step "5. Bootstrap loyverse/loyverse + premier sync"

Set-Location "$RepoPath\loyverse-sync"
npm install
npm run bootstrap-db
npm run once
Set-Location $RepoPath

# ---------------------------------------------------------------------------
Step "6. Build SPA"

npm install
npm run build

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
pm2 delete loyverse-sync 2>$null | Out-Null
pm2 start npm --name loyverse-sync --cwd "$RepoPath\loyverse-sync" -- start

pm2 delete nginx 2>$null | Out-Null
# `-g "daemon off;"` keeps nginx in the foreground - nginx daemonizes by
# default, which would make pm2 think the process exited immediately.
pm2 start "$NginxRoot\nginx.exe" --name nginx --cwd $NginxRoot -- -g "daemon off;"

pm2 save

Write-Host ""
Write-Host "== Termine ==" -ForegroundColor Green
Write-Host "Docker (surrealdb/gateway/printer) redemarre seul si Docker Desktop est configure pour se lancer a l'ouverture de session (Settings > General)."
Write-Host "loyverse-sync + nginx redemarrent via pm2 (pm2-startup) au reboot."
Write-Host "Verifie la checklist smoke test : docs/deploy/PROD-LOYVERSE.md #8"
Write-Host "UI: http://$ip/"
