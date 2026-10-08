<#
  Generate per-install PWA icons + login background from a client logo.

  Usage (from repo root):
    .\scripts\generate-branding-icons.ps1 -LogoPath "C:\path\to\logo.jpg"
    .\scripts\generate-branding-icons.ps1 -LogoPath ".\logo.png" -EmblemCrop

  Writes to public/branding/ (gitignored). After a logo change in the POS
  restaurant profile UI, icons update at runtime automatically — this script
  is only needed for the static install files (login page before first
  sign-in, and Add-to-Home-Screen before the profile has loaded).
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$LogoPath,
  # Crop the top-center square (good for wide logos with a mark on top).
  # Omit for letterbox of the full logo on a white square.
  [switch]$EmblemCrop,
  [string]$OutDir = ""
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not $OutDir) {
  $OutDir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "public\branding"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$resolved = Resolve-Path $LogoPath
$src = [System.Drawing.Image]::FromFile($resolved)

# Keep a copy for the login page fallback
$ext = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
if ($ext -in @('.jpg', '.jpeg', '.png', '.webp', '.gif')) {
  Copy-Item -Force $resolved (Join-Path $OutDir "login-background$ext")
  if ($ext -ne '.jpg') {
    # login.tsx looks for login-background.jpg by default — also write jpg when possible
  }
  Copy-Item -Force $resolved (Join-Path $OutDir "login-background.jpg")
}

function New-SquareIcon {
  param([System.Drawing.Image]$Source, [int]$Size, [string]$OutPath, [bool]$CropEmblem)

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $pad = [int]($Size * 0.08)
  $dstRect = New-Object System.Drawing.Rectangle $pad, $pad, ($Size - 2 * $pad), ($Size - 2 * $pad)

  if ($CropEmblem -and $Source.Width -gt $Source.Height) {
    $crop = [Math]::Min($Source.Width, [int]($Source.Height * 0.55))
    $sx = [int](($Source.Width - $crop) / 2)
    $sy = [Math]::Max(0, [int]($Source.Height * 0.02))
    if (($sy + $crop) -gt $Source.Height) { $sy = $Source.Height - $crop }
    $srcRect = New-Object System.Drawing.Rectangle $sx, $sy, $crop, $crop
    $g.DrawImage($Source, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  } else {
    $inner = $Size - 2 * $pad
    $scale = [Math]::Min($inner / $Source.Width, $inner / $Source.Height)
    $w = [int]($Source.Width * $scale)
    $h = [int]($Source.Height * $scale)
    $x = [int](($Size - $w) / 2)
    $y = [int](($Size - $h) / 2)
    $g.DrawImage($Source, $x, $y, $w, $h)
  }

  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Host "Wrote $OutPath"
}

New-SquareIcon -Source $src -Size 192 -OutPath (Join-Path $OutDir "icon-192.png") -CropEmblem:$EmblemCrop.IsPresent
New-SquareIcon -Source $src -Size 512 -OutPath (Join-Path $OutDir "icon-512.png") -CropEmblem:$EmblemCrop.IsPresent
New-SquareIcon -Source $src -Size 180 -OutPath (Join-Path $OutDir "apple-touch-icon.png") -CropEmblem:$EmblemCrop.IsPresent

$src.Dispose()
Write-Host "Done. Icons are in $OutDir (not committed — per install)."
