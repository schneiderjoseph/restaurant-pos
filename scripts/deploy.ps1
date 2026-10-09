# Build le frontend, le met en ligne sur nginx (:80) et redemarre les services dont le code a change.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Yes        # sans questions
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -SkipBuild  # redeploie dist\ tel quel
#
# Etapes : etat git -> nouvelles migrations (a confirmer) -> npm run build -> sauvegarde de
# C:\nginx\html en html.bak-<date> -> copie de dist\ -> verification du bundle servi ->
# redemarrage des conteneurs dont le dossier a change depuis le dernier deploiement.
# Le commit deploye est note dans %LOCALAPPDATA%\posr-deploy\last-commit.txt.
param(
    [switch]$Yes,
    [switch]$SkipBuild,
    # Sauvegardes html.bak-* gardees (les plus anciennes sont supprimees).
    [int]$KeepBackups = 10
)

$ErrorActionPreference = 'Stop'

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$NginxRoot = 'C:\nginx'
$HtmlDir   = Join-Path $NginxRoot 'html'
$DistDir   = Join-Path $RepoRoot 'dist'
$StateDir  = Join-Path $env:LOCALAPPDATA 'posr-deploy'
$LastFile  = Join-Path $StateDir 'last-commit.txt'
$LogFile   = Join-Path $StateDir 'build.log'
$SiteUrl   = 'http://127.0.0.1/'

# Dossier du depot -> service docker compose. Une image construite (build:) est rebatie
# quand son Dockerfile ou package.json change.
$Services = [ordered]@{
    'printing'     = @{ Name = 'printer';  Built = $true }
    'api'          = @{ Name = 'api';      Built = $false }
    'gateway'      = @{ Name = 'gateway';  Built = $false }
    'payments'     = @{ Name = 'payment';  Built = $false }
    'tracking-api' = @{ Name = 'tracking'; Built = $false }
}

New-Item -ItemType Directory -Force $StateDir | Out-Null
Set-Location $RepoRoot

function Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Ok([string]$Text)   { Write-Host "   OK  $Text" -ForegroundColor Green }
function Warn([string]$Text) { Write-Host "   !!  $Text" -ForegroundColor Yellow }
function Fail([string]$Text) { Write-Host "   XX  $Text" -ForegroundColor Red; throw $Text }

function Confirm-Step([string]$Question) {
    if ($Yes) { return $true }
    $answer = Read-Host "   $Question (o/N)"
    return $answer -match '^(o|oui|y|yes)$'
}

function Get-ServedBundle {
    try {
        $html = (Invoke-WebRequest $SiteUrl -UseBasicParsing -TimeoutSec 10).Content
        if ($html -match 'assets/index-[^"]+\.js') { return $Matches[0] }
    } catch { }
    return $null
}

try {
    # --- 1. Etat git ---------------------------------------------------------------
    Step 'Etat du depot'
    $head = (git rev-parse --short HEAD).Trim()
    Write-Host "   Commit : $(git log -1 --format='%h %s')"
    $dirty = @(git status --porcelain)
    if ($dirty.Count -gt 0) {
        Warn "$($dirty.Count) fichier(s) non commite(s) partent aussi dans le build :"
        $dirty | Select-Object -First 15 | ForEach-Object { Write-Host "       $_" }
        if ($dirty.Count -gt 15) { Write-Host '       ...' }
    } else {
        Ok 'Rien de non commite'
    }

    $last = if (Test-Path $LastFile) { (Get-Content $LastFile -Raw).Trim() } else { '' }
    $hasLast = $false
    if ($last) {
        git rev-parse --verify --quiet "$last^{commit}" | Out-Null
        $hasLast = $LASTEXITCODE -eq 0
    }
    if ($hasLast) {
        Write-Host "   Dernier deploiement : $(git log -1 --format='%h %s' $last)"
    } else {
        Warn 'Dernier deploiement inconnu : aucun service ne sera redemarre automatiquement.'
    }

    # Fichiers changes depuis le dernier deploiement, commits + working tree.
    $changed = @()
    if ($hasLast) { $changed += @(git diff --name-only $last) }
    $changed += @(git ls-files --others --exclude-standard)
    $changed = $changed | Where-Object { $_ } | Sort-Object -Unique

    # --- 2. Migrations -------------------------------------------------------------
    Step 'Migrations'
    $migrations = @($changed | Where-Object { $_ -match '^migrations/[^/]+\.surql$' })
    if ($migrations.Count -gt 0) {
        Warn 'Nouvelles migrations depuis le dernier deploiement :'
        $migrations | ForEach-Object { Write-Host "       $_" }
        Warn 'Elles doivent etre appliquees sur la base AVANT de mettre le front en ligne,'
        Warn 'sinon les ecrans qui ecrivent ces nouveaux champs echouent.'
        if (-not (Confirm-Step 'Sont-elles deja appliquees ?')) { Fail 'Deploiement annule : appliquer les migrations puis relancer.' }
    } else {
        Ok 'Aucune nouvelle migration'
    }

    # --- 3. Build ------------------------------------------------------------------
    if ($SkipBuild) {
        Step 'Build saute (-SkipBuild)'
    } else {
        Step 'Build du frontend (npm run build)'
        $sw = [Diagnostics.Stopwatch]::StartNew()
        cmd /c "npm run build > `"$LogFile`" 2>&1"
        if ($LASTEXITCODE -ne 0) {
            Get-Content $LogFile | Select-String -Pattern 'error' | Select-Object -First 20 | ForEach-Object { Write-Host "       $_" -ForegroundColor Red }
            Fail "Build en echec, rien n'a ete deploye. Log complet : $LogFile"
        }
        Ok "Build reussi en $([int]$sw.Elapsed.TotalSeconds) s"
    }
    if (-not (Test-Path (Join-Path $DistDir 'index.html'))) { Fail 'dist\index.html introuvable.' }

    # --- 4. Mise en ligne ----------------------------------------------------------
    Step 'Mise en ligne dans C:\nginx\html'
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $NginxRoot "html.bak-$stamp"
    if (Test-Path $HtmlDir) {
        Copy-Item $HtmlDir $backup -Recurse
        Ok "Ancienne version sauvegardee : $backup"
        Get-ChildItem $HtmlDir | Remove-Item -Recurse -Force -Confirm:$false
    } else {
        New-Item -ItemType Directory $HtmlDir | Out-Null
    }
    Copy-Item (Join-Path $DistDir '*') $HtmlDir -Recurse
    Ok 'Nouvelle version copiee'

    $old = @(Get-ChildItem $NginxRoot -Directory -Filter 'html.bak-*' | Sort-Object Name -Descending | Select-Object -Skip $KeepBackups)
    if ($old.Count -gt 0) {
        $old | Remove-Item -Recurse -Force -Confirm:$false
        Ok "$($old.Count) ancienne(s) sauvegarde(s) supprimee(s) (on garde les $KeepBackups dernieres)"
    }

    $expected = if ((Get-Content (Join-Path $DistDir 'index.html') -Raw) -match 'assets/index-[^"]+\.js') { $Matches[0] } else { $null }
    $served = Get-ServedBundle
    if ($served -and $served -eq $expected) {
        Ok "Le site sert bien la nouvelle version ($served)"
    } elseif ($served) {
        Warn "Le site sert $served au lieu de $expected : le mode dev-live est peut-etre actif (scripts\dev-live.ps1 status)."
    } else {
        Warn "Le site ne repond pas sur $SiteUrl : verifier nginx."
    }

    # --- 5. Services ---------------------------------------------------------------
    Step 'Services docker'
    $restart = @(); $rebuild = @()
    foreach ($dir in $Services.Keys) {
        $svc = $Services[$dir]
        $files = @($changed | Where-Object { $_ -like "$dir/*" })
        if ($files.Count -eq 0) { continue }
        $imageFiles = @($files | Where-Object { $_ -match "^$([regex]::Escape($dir))/(Dockerfile|package(-lock)?\.json)$" })
        if ($svc.Built -and $imageFiles.Count -gt 0) { $rebuild += $svc.Name } else { $restart += $svc.Name }
    }
    # Un restart ne relit pas docker-compose.yml/.env (volumes, variables) : il faut recreer.
    # 'up -d' ne recree que les conteneurs dont la config a change.
    if ($changed -contains 'docker-compose.yml' -or $changed -contains '.env') {
        Write-Host '   docker-compose.yml ou .env a change : recreation des conteneurs concernes'
        docker compose up -d
        if ($LASTEXITCODE -ne 0) { Fail 'docker compose up en echec.' }
        Ok 'Conteneurs a jour avec docker-compose.yml'
    }

    if ($rebuild.Count -gt 0) {
        Write-Host "   Image a rebatir : $($rebuild -join ', ')"
        docker compose build @rebuild
        if ($LASTEXITCODE -ne 0) { Fail 'docker compose build en echec.' }
        docker compose up -d --force-recreate @rebuild
        if ($LASTEXITCODE -ne 0) { Fail 'docker compose up en echec.' }
        Ok "Recree(s) : $($rebuild -join ', ')"
    }
    if ($restart.Count -gt 0) {
        Write-Host "   Code modifie : $($restart -join ', ')"
        docker compose restart @restart
        if ($LASTEXITCODE -ne 0) { Fail 'docker compose restart en echec.' }
        Ok "Redemarre(s) : $($restart -join ', ')"
    }
    if ($rebuild.Count -eq 0 -and $restart.Count -eq 0) {
        Ok 'Aucun code backend modifie, aucun service redemarre'
    }

    # Conteneur Vite/Bun (:5173) : hors perimetre prod (nginx sert C:\nginx\html).
    # Sur Windows ses node_modules natifs cassent sous Linux — on l'arrete et on l'ignore.
    $ignoreServices = @('app')
    try { docker compose stop @ignoreServices | Out-Null } catch { }

    # Un service qui plante au demarrage passe en 'restarting' en boucle : la connexion
    # repond alors 502 et les tablettes affichent "PIN invalide". On attend qu'ils tiennent.
    Step 'Verification des services'
    $deadline = (Get-Date).AddSeconds(90)
    $stableSince = $null
    do {
        $bad = @(
            docker compose ps -a --format '{{.Service}} {{.State}}' |
                Where-Object {
                    $_ -and
                    $_ -notmatch ' running$' -and
                    ($ignoreServices -notcontains ($_ -split ' ')[0])
                }
        )
        if ($bad.Count -eq 0) {
            if (-not $stableSince) { $stableSince = Get-Date }
        } else {
            $stableSince = $null
        }
        if ($stableSince -and ((Get-Date) - $stableSince).TotalSeconds -ge 15) { break }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    if ($bad.Count -gt 0) {
        foreach ($line in $bad) {
            $svcName = ($line -split ' ')[0]
            Warn "$line - dernieres lignes du log :"
            docker compose logs --tail 15 $svcName | ForEach-Object { Write-Host "       $_" -ForegroundColor Red }
        }
        Fail "Service(s) en panne : $(($bad | ForEach-Object { ($_ -split ' ')[0] }) -join ', '). La connexion ne marchera pas."
    }
    $loginCode = try {
        (Invoke-WebRequest 'http://127.0.0.1/auth/login' -Method Post -ContentType 'application/json' -Body '{}' -UseBasicParsing -TimeoutSec 10).StatusCode
    } catch { [int]$_.Exception.Response.StatusCode }
    if ($loginCode -ge 500 -or $loginCode -eq 0) { Fail "La connexion repond $loginCode : le gateway ne fonctionne pas." }
    Ok "Tous les services tournent, la connexion repond ($loginCode)"

    Set-Content -Path $LastFile -Value $head -Encoding ascii

    Step 'Termine'
    Ok "Commit $head en ligne. Recharger les tablettes pour prendre la nouvelle version."
    $exitCode = 0
} catch {
    Write-Host ''
    Write-Host "ECHEC : $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
}

if (-not $Yes) {
    Write-Host ''
    Read-Host 'Appuyer sur Entree pour fermer' | Out-Null
}
exit $exitCode
