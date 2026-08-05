param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')]
    [string]$BundleId,

    [Parameter(Mandatory = $true)]
    [string]$PrivateKeyPath,

    [string]$BaseUrl = 'https://northcore-eu.de/updates/asset-editor/beta',
    [int]$NativeVersionCode = 2,
    [string]$OutputDirectory = 'live-update-output'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path $PrivateKeyPath)) {
    throw "Privater Live-Update-Schlüssel fehlt: $PrivateKeyPath"
}

npm run build
if ($LASTEXITCODE -ne 0) { throw 'Web-Build fehlgeschlagen.' }

$outputRoot = Join-Path $PWD $OutputDirectory
$bundleDirectory = Join-Path $outputRoot 'bundles'
$zipPath = Join-Path $bundleDirectory "$BundleId.zip"
$manifestPath = Join-Path $outputRoot 'manifest.json'

Remove-Item $outputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item $bundleDirectory -ItemType Directory -Force | Out-Null
Compress-Archive -Path '.\dist\*' -DestinationPath $zipPath -CompressionLevel Optimal -Force

node '.\scripts\sign-live-update-bundle.mjs' `
    $zipPath `
    $PrivateKeyPath `
    $BundleId `
    $BaseUrl `
    $NativeVersionCode `
    $manifestPath

if ($LASTEXITCODE -ne 0) { throw 'Signierung des Live-Update-Bundles fehlgeschlagen.' }

@'
<IfModule mod_headers.c>
  Header always set Access-Control-Allow-Origin "*"
  Header always set Access-Control-Allow-Methods "GET, OPTIONS"
  Header always set Access-Control-Allow-Headers "Content-Type"
</IfModule>
'@ | Set-Content (Join-Path $outputRoot '.htaccess') -Encoding ascii

Write-Host "Live-Update erstellt: $outputRoot"
Get-Item $zipPath, $manifestPath | Select-Object FullName, Length, LastWriteTime
