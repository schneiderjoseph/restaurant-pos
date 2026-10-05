# Sert la version dev (Vite + HMR, working tree) sur le port de la prod (nginx :80).
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev-live.ps1 on      # :80 -> Vite dev
#   powershell -ExecutionPolicy Bypass -File scripts\dev-live.ps1 off     # :80 -> build statique (C:\nginx\html)
#   powershell -ExecutionPolicy Bypass -File scripts\dev-live.ps1 status
#
# Seul le frontend change de mode : /auth, /rpc, /alerts, /print, /tracking restent
# proxifies par nginx vers les conteneurs docker. Si Vite tombe, nginx retombe sur
# le build statique (error_page 502/504), donc les tablettes ne voient jamais de 502.
param(
    [Parameter(Position = 0)]
    [ValidateSet('on', 'off', 'status')]
    [string]$Mode = 'status'
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$NginxRoot  = 'C:\nginx'
$NginxExe   = Join-Path $NginxRoot 'nginx.exe'
$LiveConf   = Join-Path $NginxRoot 'conf\nginx-posr.conf'
$StaticConf = Join-Path $NginxRoot 'conf\nginx-posr.static.conf.bak'
$DevPort    = 5173
$StateDir   = Join-Path $env:LOCALAPPDATA 'posr-dev-live'
$PidFile    = Join-Path $StateDir 'vite.pid'
$LogFile    = Join-Path $StateDir 'vite.log'
$ErrFile    = Join-Path $StateDir 'vite.err.log'
$DevMarker  = '# posr-dev-live'

New-Item -ItemType Directory -Force $StateDir | Out-Null

function Test-DevConf { (Get-Content $LiveConf -Raw) -match [regex]::Escape($DevMarker) }

function Get-VitePid {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $DevPort -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    return $null
}

function Write-ConfNoBom([string]$Path, [string]$Text) {
    # nginx refuse un BOM en tete de fichier
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Invoke-NginxReload {
    & $NginxExe -p $NginxRoot -t
    if ($LASTEXITCODE -ne 0) { throw 'nginx -t a echoue' }
    & $NginxExe -p $NginxRoot -s reload
    if ($LASTEXITCODE -ne 0) { throw 'nginx reload a echoue' }
}

function Start-Vite {
    if (Get-VitePid) { return }
    $vite = Join-Path $RepoRoot 'node_modules\vite\bin\vite.js'
    $proc = Start-Process -FilePath 'node' -ArgumentList "`"$vite`"" -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile -PassThru
    $proc.Id | Set-Content $PidFile
    for ($i = 0; $i -lt 60; $i++) {
        if (Get-VitePid) { return }
        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 500
    }
    throw "Vite n'a pas demarre sur :$DevPort - voir $ErrFile"
}

function Stop-Vite {
    $vitePid = Get-VitePid
    if ($vitePid) { Stop-Process -Id $vitePid -Force }
    Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Show-Status {
    $vitePid = Get-VitePid
    $front = if (Test-DevConf) { 'DEV (Vite)' } else { 'STATIQUE (C:\nginx\html)' }
    $viteState = if ($vitePid) { "en marche, PID $vitePid, port $DevPort" } else { 'arrete' }
    "nginx :80 -> $front"
    "Vite      -> $viteState"
    "logs      -> $LogFile"
}

switch ($Mode) {
    'on' {
        if (Test-DevConf) {
            Start-Vite
        } else {
            $static = Get-Content $LiveConf -Raw
            Write-ConfNoBom $StaticConf $static

            $devRoot = @"
    $DevMarker : genere par scripts/dev-live.ps1, ne pas editer (off = restaure le .bak)
    location / {
        proxy_pass http://127.0.0.1:$DevPort;
        proxy_http_version 1.1;
        proxy_set_header Upgrade `$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host localhost;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        error_page 502 504 = @static;
    }

    location @static {
        try_files `$uri /index.html;
    }
"@
            $dev = [regex]::Replace($static, '(?m)^[ \t]*location / \{[^}]*\}\r?\n', { param($m) $devRoot + "`r`n" }, 1)
            $dev = [regex]::Replace($dev, '(?m)^[ \t]*location /assets/ \{[^}]*\}\r?\n(\r?\n)?', '')
            if ($dev -notmatch [regex]::Escape($DevMarker)) { throw "bloc 'location /' introuvable dans $LiveConf" }

            Start-Vite
            Write-ConfNoBom $LiveConf $dev
            try { Invoke-NginxReload } catch {
                Write-ConfNoBom $LiveConf $static
                throw
            }
        }
        Show-Status
    }
    'off' {
        if (Test-DevConf) {
            if (-not (Test-Path $StaticConf)) { throw "sauvegarde introuvable: $StaticConf" }
            Write-ConfNoBom $LiveConf (Get-Content $StaticConf -Raw)
            Invoke-NginxReload
        }
        Stop-Vite
        Show-Status
    }
    'status' { Show-Status }
}
